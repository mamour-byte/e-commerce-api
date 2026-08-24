import { IsString, IsStrongPassword, MinLength } from 'class-validator';

export class ChangePasswordDto {
	@IsString()
	@MinLength(1)
	currentPassword!: string;

	@IsString()
	@IsStrongPassword({
		minLength: 8,
		minLowercase: 1,
		minUppercase: 1,
		minNumbers: 1,
		minSymbols: 1,
	})
	newPassword!: string;
}
