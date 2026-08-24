import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UserQueryDto } from './dto/user-query.dto';

const PUBLIC_FIELDS = {
	id: true,
	email: true,
	firstName: true,
	lastName: true,
	phone: true,
	role: true,
	status: true,
	emailVerified: true,
	createdAt: true,
	updatedAt: true,
} as const;

@Injectable()
export class UsersService {
	constructor(private readonly prisma: PrismaService) {}

	async findAll(query: UserQueryDto) {
		const { search, role, status, page = 1, limit = 20 } = query;

		const where = {
			...(search && {
				OR: [
					{ firstName: { contains: search, mode: 'insensitive' as const } },
					{ lastName: { contains: search, mode: 'insensitive' as const } },
					{ email: { contains: search, mode: 'insensitive' as const } },
				],
			}),
			...(role && { role }),
			...(status && { status }),
		};

		const skip = (page - 1) * limit;

		const [users, total] = await Promise.all([
			this.prisma.user.findMany({
				where,
				select: PUBLIC_FIELDS,
				skip,
				take: limit,
				orderBy: { createdAt: 'desc' },
			}),
			this.prisma.user.count({ where }),
		]);

		return {
			data: users,
			meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
		};
	}

	async findOne(id: string) {
		const user = await this.prisma.user.findUnique({
			where: { id },
			select: PUBLIC_FIELDS,
		});
		if (!user) throw new NotFoundException('Utilisateur introuvable.');
		return user;
	}

	async findActiveUser(id: string) {
		const user = await this.prisma.user.findUnique({ where: { id } });
		if (!user || user.status !== UserStatus.ACTIVE)
			throw new ForbiddenException('Account inactive or not found.');
		return {
			id: user.id,
			email: user.email,
			firstName: user.firstName,
			lastName: user.lastName,
			role: user.role,
		};
	}

	async updateProfile(id: string, dto: UpdateProfileDto) {
		await this.findOne(id);

		return this.prisma.user.update({
			where: { id },
			data: {
				...(dto.firstName !== undefined && { firstName: dto.firstName.trim() }),
				...(dto.lastName !== undefined && { lastName: dto.lastName.trim() }),
				...(dto.phone !== undefined && { phone: dto.phone.trim() }),
			},
			select: PUBLIC_FIELDS,
		});
	}

	async changePassword(id: string, dto: ChangePasswordDto) {
		const user = await this.prisma.user.findUnique({ where: { id } });
		if (!user) throw new NotFoundException('Utilisateur introuvable.');

		const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
		if (!valid) throw new BadRequestException('Mot de passe actuel incorrect.');

		if (dto.currentPassword === dto.newPassword)
			throw new BadRequestException('Le nouveau mot de passe doit être différent.');

		const passwordHash = await bcrypt.hash(dto.newPassword, 12);
		await this.prisma.user.update({ where: { id }, data: { passwordHash } });

		// Révoquer toutes les sessions actives après changement de mot de passe
		await this.prisma.refreshToken.updateMany({
			where: { userId: id, revokedAt: null },
			data: { revokedAt: new Date() },
		});
	}

	async updateRole(id: string, dto: UpdateRoleDto) {
		await this.findOne(id);
		return this.prisma.user.update({
			where: { id },
			data: { role: dto.role },
			select: PUBLIC_FIELDS,
		});
	}

	async updateStatus(id: string, dto: UpdateStatusDto) {
		await this.findOne(id);
		return this.prisma.user.update({
			where: { id },
			data: { status: dto.status },
			select: PUBLIC_FIELDS,
		});
	}

	async remove(id: string, requesterId: string, requesterRole: UserRole) {
		await this.findOne(id);

		if (requesterRole !== UserRole.ADMIN && requesterId !== id)
			throw new ForbiddenException('Action non autorisée.');

		// Soft delete : suspension du compte + révocation de toutes les sessions
		await this.prisma.refreshToken.updateMany({
			where: { userId: id, revokedAt: null },
			data: { revokedAt: new Date() },
		});

		return this.prisma.user.update({
			where: { id },
			data: { status: UserStatus.SUSPENDED },
			select: PUBLIC_FIELDS,
		});
	}
}
