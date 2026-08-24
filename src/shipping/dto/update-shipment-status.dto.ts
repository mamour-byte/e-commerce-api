import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ShipmentStatus } from '@prisma/client';

export class UpdateShipmentStatusDto {
	@IsEnum(ShipmentStatus)
	@IsNotEmpty()
	status: ShipmentStatus;

	@IsString()
	@IsOptional()
	carrier?: string;

	@IsString()
	@IsOptional()
	trackingNumber?: string;

	@Type(() => Date)
	@IsDate()
	@IsOptional()
	shippedAt?: Date;

	@Type(() => Date)
	@IsDate()
	@IsOptional()
	deliveredAt?: Date;
}
