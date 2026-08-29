import {
	IsArray,
	IsBoolean,
	IsNotEmpty,
	IsOptional,
	IsString,
	ValidateIf,
} from 'class-validator';

export class CreateDeliveryNeighborhoodDto {
	@ValidateIf((dto) => !dto.names || dto.names.length === 0)
	@IsString()
	@IsNotEmpty()
	name?: string;

	@IsArray()
	@IsString({ each: true })
	@IsOptional()
	names?: string[];

	@IsString()
	@IsNotEmpty()
	deliveryZoneId: string;

	@IsBoolean()
	@IsOptional()
	isActive?: boolean = true;
}
