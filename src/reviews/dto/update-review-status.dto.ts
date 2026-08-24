import { IsEnum, IsNotEmpty } from 'class-validator';
import { ReviewStatus } from '@prisma/client';

export class UpdateReviewStatusDto {
	@IsEnum(ReviewStatus)
	@IsNotEmpty()
	status: ReviewStatus;
}
