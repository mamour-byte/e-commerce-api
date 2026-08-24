import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ReviewStatus } from '@prisma/client';

export class ReviewQueryDto {
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
	productId?: string;

	@IsEnum(ReviewStatus)
	@IsOptional()
	status?: ReviewStatus;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(5)
	@IsOptional()
	rating?: number;

	@IsString()
	@IsOptional()
	sortBy?: string = 'createdAt';

	@IsString()
	@IsOptional()
	sortOrder?: 'asc' | 'desc' = 'desc';
}
