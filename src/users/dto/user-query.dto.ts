import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { UserRole, UserStatus } from '@prisma/client';

export class UserQueryDto {
	@IsOptional()
	@IsString()
	@MaxLength(100)
	search?: string;

	@IsOptional()
	@IsEnum(UserRole)
	role?: UserRole;

	@IsOptional()
	@IsEnum(UserStatus)
	status?: UserStatus;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	page?: number = 1;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	limit?: number = 20;
}
