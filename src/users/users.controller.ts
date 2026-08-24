import {
	Body,
	Controller,
	Delete,
	ForbiddenException,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Patch,
	Query,
	UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';

import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UserQueryDto } from './dto/user-query.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

type AuthUser = { id: string; role: UserRole };

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
	constructor(private readonly usersService: UsersService) {}

	/**
	 * ADMIN — liste tous les utilisateurs
	 */
	@Get()
	@UseGuards(RolesGuard)
	@Roles(UserRole.ADMIN)
	findAll(@Query() query: UserQueryDto) {
		return this.usersService.findAll(query);
	}

	/**
	 * ADMIN — voir n'importe quel utilisateur
	 * OWNER — voir son propre profil via /users/:id
	 */
	@Get(':id')
	findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
		if (user.role !== UserRole.ADMIN && user.id !== id)
			throw new ForbiddenException();
		return this.usersService.findOne(id);
	}

	/**
	 * OWNER — mettre à jour son propre profil
	 */
	@Patch(':id/profile')
	updateProfile(
		@Param('id') id: string,
		@Body() dto: UpdateProfileDto,
		@CurrentUser() user: AuthUser,
	) {
		if (user.role !== UserRole.ADMIN && user.id !== id)
			throw new ForbiddenException();
		return this.usersService.updateProfile(id, dto);
	}

	/**
	 * OWNER — changer son mot de passe
	 */
	@Patch(':id/password')
	@HttpCode(HttpStatus.NO_CONTENT)
	changePassword(
		@Param('id') id: string,
		@Body() dto: ChangePasswordDto,
		@CurrentUser() user: AuthUser,
	) {
		if (user.id !== id) throw new ForbiddenException();
		return this.usersService.changePassword(id, dto);
	}

	/**
	 * ADMIN — changer le rôle d'un utilisateur
	 */
	@Patch(':id/role')
	@UseGuards(RolesGuard)
	@Roles(UserRole.ADMIN)
	updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
		return this.usersService.updateRole(id, dto);
	}

	/**
	 * ADMIN — changer le statut d'un utilisateur
	 */
	@Patch(':id/status')
	@UseGuards(RolesGuard)
	@Roles(UserRole.ADMIN)
	updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
		return this.usersService.updateStatus(id, dto);
	}

	/**
	 * ADMIN — supprimer (soft) n'importe quel compte
	 * OWNER — supprimer son propre compte
	 */
	@Delete(':id')
	@HttpCode(HttpStatus.OK)
	remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
		return this.usersService.remove(id, user.id, user.role);
	}
}
