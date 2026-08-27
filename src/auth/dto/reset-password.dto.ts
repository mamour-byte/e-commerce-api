import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
	@IsString()
	@MinLength(1)
	token!: string;

	@IsString()
	@MinLength(8)
	@MaxLength(128)
	newPassword!: string;
}
