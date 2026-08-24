import {
	ConflictException,
	Injectable,
	UnauthorizedException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
	constructor(
		private readonly prisma: PrismaService,
		private readonly jwt: JwtService,
		private readonly usersService: UsersService,
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

	@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
	async cleanExpiredTokens(): Promise<void> {
		await this.prisma.refreshToken.deleteMany({
			where: { expiresAt: { lt: new Date() } },
		});
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
