import { FulfillmentType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
	IsArray,
	IsEmail,
	IsEnum,
	IsNotEmpty,
	IsOptional,
	IsString,
	ValidateIf,
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

	@IsEnum(FulfillmentType)
	@IsNotEmpty()
	fulfillmentType: FulfillmentType = FulfillmentType.PICKUP;

	@ValidateIf((dto) => dto.fulfillmentType === FulfillmentType.DELIVERY)
	@IsString()
	@IsNotEmpty()
	deliveryZoneId?: string;

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

	@ValidateIf((dto) => dto.fulfillmentType === FulfillmentType.DELIVERY)
	@IsString()
	@IsNotEmpty()
	shippingAddress?: string;

	@IsString()
	@IsOptional()
	shippingCity?: string;

	@ValidateIf((dto) => dto.fulfillmentType === FulfillmentType.DELIVERY)
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
}
