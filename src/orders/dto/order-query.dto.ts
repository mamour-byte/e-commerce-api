import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { OrderStatus, PaymentStatus } from '@prisma/client';

export class OrderQueryDto {
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

	@IsEnum(OrderStatus)
	@IsOptional()
	status?: OrderStatus;

	@IsEnum(PaymentStatus)
	@IsOptional()
	paymentStatus?: PaymentStatus;

	@IsString()
	@IsOptional()
	search?: string;

	@IsString()
	@IsOptional()
	sortBy?: string = 'createdAt';

	@IsString()
	@IsOptional()
	sortOrder?: 'asc' | 'desc' = 'desc';
}
