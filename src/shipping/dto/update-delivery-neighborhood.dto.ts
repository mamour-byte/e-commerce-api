import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateDeliveryNeighborhoodDto {
	@IsString()
	@IsNotEmpty()
	@IsOptional()
	name?: string;

	@IsString()
	@IsNotEmpty()
	@IsOptional()
	deliveryZoneId?: string;

	@IsBoolean()
	@IsOptional()
	isActive?: boolean;
}
