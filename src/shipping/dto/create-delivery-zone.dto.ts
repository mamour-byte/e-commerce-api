import { Type } from 'class-transformer';
import {
	IsArray,
	IsBoolean,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	Min,
} from 'class-validator';

export class CreateDeliveryZoneDto {
	@IsString()
	@IsNotEmpty()
	name: string;

	@IsString()
	@IsOptional()
	description?: string;

	@Type(() => Number)
	@IsNumber()
	@Min(0)
	price: number;

	@Type(() => Number)
	@IsInt()
	@Min(0)
	@IsOptional()
	sortOrder?: number;

	@IsBoolean()
	@IsOptional()
	isActive?: boolean = true;

	@IsArray()
	@IsString({ each: true })
	@IsOptional()
	neighborhoods?: string[];
}
