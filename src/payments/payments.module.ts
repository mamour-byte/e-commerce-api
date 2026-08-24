import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { OrangeMoneyService } from './providers/orange-money.service';
import { WaveService } from './providers/wave.service';

@Module({
	imports: [PrismaModule, ConfigModule, MailModule],
	controllers: [PaymentsController],
	providers: [PaymentsService, WaveService, OrangeMoneyService],
	exports: [PaymentsService, WaveService, OrangeMoneyService],
})
export class PaymentsModule {}
