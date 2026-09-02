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
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

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

@Injectable()
export class AuthService {
	private readonly logger = new Logger(AuthService.name);

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
		if (!user || user.status !== 'ACTIVE' || !(await bcrypt.compare(dto.password, user.passwordHash))) {
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
		if (!stored || stored.user.status !== 'ACTIVE') throw new UnauthorizedException('Invalid refresh token');

		await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
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
		const message = 'Si un compte avec cet email existe, un lien de réinitialisation a été envoyé.';

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
		const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3001');
		const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

		// Send the email (fire-and-forget: don't block or leak errors)
		this.mailService
			.sendPasswordResetEmail(user.email, user.firstName, resetUrl)
			.catch((err) => this.logger.error('Failed to send password reset email', err));

		return { message };
	}

	async resetPassword(rawToken: string, newPassword: string): Promise<{ message: string }> {
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
			throw new BadRequestException('Le lien de réinitialisation est invalide ou a expiré.');
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
		await Promise.all([
			this.prisma.refreshToken.deleteMany({
				where: { expiresAt: { lt: new Date() } },
			}),
			this.prisma.passwordResetToken.deleteMany({
				where: {
					OR: [
						{ expiresAt: { lt: new Date() } },
						{ usedAt: { not: null } },
					],
				},
			}),
		]);
	}

	findActiveUser(id: string) {
		return this.usersService.findActiveUser(id);
	}

	private async issueSession(user: UserRecord, metadata: TokenMetadata, sessionId = randomBytes(16).toString('hex')) {
		const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role });
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
		return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role };
	}
}
