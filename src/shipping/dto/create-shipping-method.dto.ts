import { Type } from 'class-transformer';
import {
	IsBoolean,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	Min,
} from 'class-validator';

export class CreateShippingMethodDto {
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
	estimatedMinDays?: number;

	@Type(() => Number)
	@IsInt()
	@Min(0)
	@IsOptional()
	estimatedMaxDays?: number;

	@IsBoolean()
	@IsOptional()
	isActive?: boolean = true;
}
