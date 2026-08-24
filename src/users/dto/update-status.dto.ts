import { IsEnum } from 'class-validator';
import { UserStatus } from '@prisma/client';

export class UpdateStatusDto {
	@IsEnum(UserStatus)
	status!: UserStatus;
}
