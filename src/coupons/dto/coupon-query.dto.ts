import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CouponType } from '@prisma/client';

export class CouponQueryDto {
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@IsOptional()
	page?: number = 1;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@IsOptional()
	limit?: number = 10;

	@IsString()
	@IsOptional()
	search?: string;

	@IsEnum(CouponType)
	@IsOptional()
	type?: CouponType;

	@Type(() => Boolean)
	@IsBoolean()
	@IsOptional()
	isActive?: boolean;

	@IsString()
	@IsOptional()
	sortBy?: string = 'createdAt';

	@IsString()
	@IsOptional()
	sortOrder?: 'asc' | 'desc' = 'desc';
}
