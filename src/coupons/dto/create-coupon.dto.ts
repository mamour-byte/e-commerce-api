import { Type } from 'class-transformer';
import {
	IsBoolean,
	IsDate,
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	Min,
} from 'class-validator';
import { CouponType } from '@prisma/client';

export class CreateCouponDto {
	@IsString()
	@IsNotEmpty()
	code: string;

	@IsString()
	@IsOptional()
	description?: string;

	@IsEnum(CouponType)
	@IsNotEmpty()
	type: CouponType;

	@Type(() => Number)
	@IsNumber()
	@Min(0)
	value: number;

	@Type(() => Number)
	@IsNumber()
	@Min(0)
	@IsOptional()
	minimumOrderAmount?: number;

	@Type(() => Number)
	@IsNumber()
	@Min(0)
	@IsOptional()
	maximumDiscount?: number;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@IsOptional()
	usageLimit?: number;

	@Type(() => Date)
	@IsDate()
	@IsOptional()
	startsAt?: Date;

	@Type(() => Date)
	@IsDate()
	@IsOptional()
	expiresAt?: Date;

	@IsBoolean()
	@IsOptional()
	isActive?: boolean = true;
}
