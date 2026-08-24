import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
	@IsOptional()
	@IsString()
	@MinLength(2)
	@MaxLength(100)
	firstName?: string;

	@IsOptional()
	@IsString()
	@MinLength(2)
	@MaxLength(100)
	lastName?: string;

	@IsOptional()
	@IsString()
	@MaxLength(30)
	phone?: string;
}
