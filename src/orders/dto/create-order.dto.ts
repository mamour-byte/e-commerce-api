import { Type } from 'class-transformer';
import {
	IsArray,
	IsEmail,
	IsNotEmpty,
	IsOptional,
	IsString,
	ValidateNested,
} from 'class-validator';
import { CreateOrderItemDto } from './create-order-item.dto';

export class CreateOrderDto {
	@IsString()
	@IsOptional()
	cartId?: string;

	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CreateOrderItemDto)
	@IsOptional()
	items?: CreateOrderItemDto[];

	@IsEmail()
	@IsOptional()
	customerEmail?: string;

	@IsString()
	@IsNotEmpty()
	customerPhone: string;

	@IsString()
	@IsOptional()
	shippingFirstName?: string;

	@IsString()
	@IsOptional()
	shippingLastName?: string;

	@IsString()
	@IsOptional()
	shippingPhone?: string;

	@IsString()
	@IsNotEmpty()
	shippingAddress: string;

	@IsString()
	@IsNotEmpty()
	shippingCity: string;

	@IsString()
	@IsOptional()
	shippingRegion?: string;

	@IsString()
	@IsOptional()
	shippingCountry?: string = 'SN';

	@IsString()
	@IsOptional()
	couponCode?: string;

	@IsString()
	@IsOptional()
	notes?: string;

	@IsString()
	@IsOptional()
	shippingMethodId?: string;
}
