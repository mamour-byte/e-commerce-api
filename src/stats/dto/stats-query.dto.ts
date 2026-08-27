import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class StatsQueryDto {
	@IsDateString()
	@IsOptional()
	startDate?: string;

	@IsDateString()
	@IsOptional()
	endDate?: string;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	@IsOptional()
	limit?: number = 10;
}
