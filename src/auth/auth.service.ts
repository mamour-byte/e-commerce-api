import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { SocialProvider, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import * as appleSignin from 'apple-signin-auth';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour
const APPLE_TX_TTL_MS = 10 * 60 * 1000; // 10 min — Apple transaction lifetime
const APPLE_CODE_TTL_MS = 2 * 60 * 1000; // 2 min — transfer code lifetime

export type TokenMetadata = { ipAddress?: string; userAgent?: string };

type AuthUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
};

type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  status: string;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

type AppleTx = {
  cookieHash: string; // SHA-256 of the apple_tx cookie value
  expiry: number;
};

type AppleCode = {
  session: { accessToken: string; refreshToken: string; user: ReturnType<AuthService['publicUser']> };
  expiry: number;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // In-memory stores for Apple OAuth transactions and transfer codes.
  // For multi-instance deployments, replace with a shared Redis cache.
  private readonly appleTxs = new Map<string, AppleTx>();
  private readonly appleCodes = new Map<string, AppleCode>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto, metadata: TokenMetadata) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Unable to create account');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone?.trim(),
      },
    });

    // Email de bienvenue (fire-and-forget : ne bloque pas l'inscription
    // et ne fait pas échouer la requête en cas de problème d'envoi).
    this.mailService
      .sendWelcomeEmail(user.email, user.firstName)
      .catch((err) => this.logger.error('Failed to send welcome email', err));

    return this.issueSession(user, metadata);
  }

  async login(dto: LoginDto, metadata: TokenMetadata) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });
    // Reject social-only accounts (empty passwordHash) before calling bcrypt
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !user.passwordHash ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueSession(user, metadata);
  }

  async refresh(rawToken: string, metadata: TokenMetadata) {
    const tokenHash = hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!stored || stored.user.status !== 'ACTIVE')
      throw new UnauthorizedException('Invalid refresh token');

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueSession(stored.user, metadata, stored.sessionId);
  }

  async logout(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ─── Forgot / Reset Password ────────────────────────────────

  async forgotPassword(email: string): Promise<{ message: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const message =
      'Si un compte avec cet email existe, un lien de réinitialisation a été envoyé.';

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Always return the same response to prevent email enumeration
    if (!user || user.status !== 'ACTIVE') {
      return { message };
    }

    // Invalidate all previous reset tokens for this user
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // Generate a cryptographically secure token
    const rawToken = randomBytes(48).toString('base64url');
    const tokenHash = hashToken(rawToken);

    await this.prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });

    // Build the reset URL
    const frontendUrl =
      this.config.get<string>('FRONTEND_BROWSER_URL') ||
      this.config.get<string>('FRONTEND_URL', 'http://localhost:3001');
    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

    // Send the email (fire-and-forget: don't block or leak errors)
    this.mailService
      .sendPasswordResetEmail(user.email, user.firstName, resetUrl)
      .catch((err) =>
        this.logger.error('Failed to send password reset email', err),
      );

    return { message };
  }

  async resetPassword(
    rawToken: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const tokenHash = hashToken(rawToken);

    const resetToken = await this.prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!resetToken) {
      throw new BadRequestException(
        'Le lien de réinitialisation est invalide ou a expiré.',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Atomic transaction: update password + mark token used + revoke all sessions
    await this.prisma.$transaction([
      // Update the user's password
      this.prisma.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      // Mark the token as used
      this.prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      // Revoke all active refresh tokens (force logout from all sessions)
      this.prisma.refreshToken.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { message: 'Votre mot de passe a été réinitialisé avec succès.' };
  }

  // ─── Cron Jobs ──────────────────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanExpiredTokens(): Promise<void> {
    const now = Date.now();
    for (const [k, v] of this.appleTxs) if (now > v.expiry) this.appleTxs.delete(k);
    for (const [k, v] of this.appleCodes) if (now > v.expiry) this.appleCodes.delete(k);
    await Promise.all([
      this.prisma.refreshToken.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      }),
      this.prisma.passwordResetToken.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }],
        },
      }),
    ]);
  }

  // ─── Social Auth ─────────────────────────────────────────────

  /**
   * Step 1 — called by the frontend before redirecting to Apple.
   * Returns a state token and the cookie value to set (HttpOnly, Secure, SameSite=None).
   * The cookie binds the transaction to the originating browser.
   */
  initiateApple(): { state: string; cookieValue: string } {
    const state = randomBytes(16).toString('hex');
    const cookieValue = randomBytes(16).toString('hex');
    this.appleTxs.set(state, {
      cookieHash: hashToken(cookieValue),
      expiry: Date.now() + APPLE_TX_TTL_MS,
    });
    return { state, cookieValue };
  }

  /**
   * Step 2 — Apple POSTs here (form_post).
   * Verifies state exists, then verifies the cookie hash matches the originating browser.
   * Issues a session and stores it behind a short-lived transfer code.
   * Returns the frontend redirect URL with only the opaque code in the query string.
   */
  async appleCallback(
    idToken: string,
    state: string,
    cookieValue: string | undefined,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<string> {
    const tx = this.appleTxs.get(state);
    this.appleTxs.delete(state); // consume immediately — one-time use

    if (!tx || Date.now() > tx.expiry) {
      throw new UnauthorizedException('Apple transaction expired or not found');
    }
    // Verify the cookie ties this callback to the browser that initiated the flow
    if (!cookieValue || hashToken(cookieValue) !== tx.cookieHash) {
      throw new UnauthorizedException('Apple transaction cookie mismatch');
    }

    const session = await this.socialLogin(
      SocialProvider.APPLE,
      idToken,
      { ipAddress, userAgent },
    );

    // Store the session behind a short-lived opaque transfer code
    const code = randomBytes(24).toString('base64url');
    this.appleCodes.set(code, { session, expiry: Date.now() + APPLE_CODE_TTL_MS });

    const frontendUrl =
      this.config.get<string>('FRONTEND_BROWSER_URL') ??
      this.config.get<string>('FRONTEND_URL', 'http://localhost:5173');

    return `${frontendUrl}/auth/apple/callback?code=${encodeURIComponent(code)}`;
  }

  /**
   * Step 3 — frontend exchanges the opaque code for the actual session tokens.
   * The code is consumed on first use and expires after APPLE_CODE_TTL_MS.
   */
  exchangeAppleCode(code: string) {
    const entry = this.appleCodes.get(code);
    this.appleCodes.delete(code); // one-time use
    if (!entry || Date.now() > entry.expiry) {
      throw new UnauthorizedException('Apple code expired or already used');
    }
    return entry.session;
  }

  async socialLogin(
    provider: SocialProvider,
    idToken: string,
    metadata: TokenMetadata,
  ) {
    const { providerId, email, firstName, lastName } =
      provider === SocialProvider.GOOGLE
        ? await this.verifyGoogleToken(idToken)
        : await this.verifyAppleToken(idToken);

    // Find existing social identity
    const existing = await this.prisma.socialIdentity.findUnique({
      where: { provider_providerId: { provider, providerId } },
      include: { user: true },
    });

    if (existing) {
      if (existing.user.status !== 'ACTIVE')
        throw new UnauthorizedException('Account suspended');
      return this.issueSession(existing.user, metadata);
    }

    // Only link to an existing account when the provider has verified the email.
    // emailVerified is always true here (both helpers throw otherwise), but the
    // explicit check makes the invariant visible and safe against future changes.
    let user = email
      ? await this.prisma.user.findUnique({ where: { email } })
      : null;

    if (!user) {
      if (!email) throw new UnauthorizedException('Email required from provider');
      user = await this.prisma.user.create({
        data: {
          email,
          // Sentinel value — never matches any bcrypt hash.
          // login() rejects empty passwordHash before calling bcrypt.
          passwordHash: '',
          firstName: firstName ?? null,
          lastName: lastName ?? null,
          emailVerified: true,
        },
      });
    }

    await this.prisma.socialIdentity.create({
      data: { provider, providerId, userId: user.id },
    });

    return this.issueSession(user, metadata);
  }

  private async verifyGoogleToken(idToken: string) {
    const clientId = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload) throw new UnauthorizedException('Invalid Google token');
    if (!payload.email_verified)
      throw new UnauthorizedException('Google email not verified');
    return {
      providerId: payload.sub,
      email: payload.email,
      emailVerified: true as const,
      firstName: payload.given_name,
      lastName: payload.family_name,
    };
  }

  private async verifyAppleToken(idToken: string) {
    const clientId = this.config.getOrThrow<string>('APPLE_CLIENT_ID');
    const payload = await appleSignin.verifyIdToken(idToken, {
      audience: clientId,
      ignoreExpiration: false,
    });
    // Apple sends email_verified as a boolean or the string "true"
    const emailVerified =
      payload.email_verified === true ||
      (payload.email_verified as unknown) === 'true';
    if (!emailVerified)
      throw new UnauthorizedException('Apple email not verified');
    return {
      providerId: payload.sub,
      email: payload.email,
      emailVerified: true as const,
      firstName: undefined as string | undefined,
      lastName: undefined as string | undefined,
    };
  }

  findActiveUser(id: string) {
    return this.usersService.findActiveUser(id);
  }

  private async issueSession(
    user: UserRecord,
    metadata: TokenMetadata,
    sessionId = randomBytes(16).toString('hex'),
  ) {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        sessionId,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        userAgent: metadata.userAgent,
        ipAddress: metadata.ipAddress,
      },
    });
    return { accessToken, refreshToken, user: this.publicUser(user) };
  }

  private publicUser(user: UserRecord): AuthUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    };
  }
}
