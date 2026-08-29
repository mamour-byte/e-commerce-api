import { IsString, IsStrongPassword, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
	@IsString()
	@MinLength(1)
	token!: string;

	@IsString()
	@IsStrongPassword({
		minLength: 6,
		minLowercase: 1,
		minUppercase: 1,
		minNumbers: 1,
		minSymbols: 0,
	})
	@MaxLength(128)
	newPassword!: string;
}
