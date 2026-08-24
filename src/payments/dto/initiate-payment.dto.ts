import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { PaymentProvider } from '@prisma/client';

export class InitiatePaymentDto {
	@IsString()
	@IsNotEmpty()
	orderId: string;

	@IsEnum(PaymentProvider)
	@IsNotEmpty()
	provider: PaymentProvider;

	@IsString()
	@IsOptional()
	customerPhoneNumber?: string;
}
