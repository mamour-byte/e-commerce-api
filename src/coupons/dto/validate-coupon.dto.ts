import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class ValidateCouponDto {
	@IsString()
	@IsNotEmpty()
	code: string;

	@Type(() => Number)
	@IsNumber()
	@Min(0)
	subtotal: number;

	@Type(() => Number)
	@IsNumber()
	@Min(0)
	@IsOptional()
	shippingAmount?: number = 0;
}
