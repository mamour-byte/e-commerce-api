import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateOrderItemDto {
	@IsString()
	@IsNotEmpty()
	productId: string;

	@IsString()
	@IsOptional()
	variantId?: string;

	@IsInt()
	@Min(1)
	quantity: number;
}
