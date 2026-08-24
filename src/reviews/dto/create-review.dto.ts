import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateReviewDto {
	@IsString()
	@IsNotEmpty()
	productId: string;

	@IsString()
	@IsOptional()
	orderId?: string;

	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(5)
	rating: number;

	@IsString()
	@IsOptional()
	title?: string;

	@IsString()
	@IsOptional()
	comment?: string;
}
