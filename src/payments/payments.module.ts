import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TrackingModule } from '../tracking/tracking.module';
import { PaymentsController } from './payments.controller';
import { PaymentsJobsService } from './payments.jobs';
import { PaymentsService } from './payments.service';
import { BictorysService } from './providers/bictorys.service';
import { OrangeMoneyService } from './providers/orange-money.service';
import { WaveService } from './providers/wave.service';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    MailModule,
    NotificationsModule,
    TrackingModule,
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentsJobsService,
    WaveService,
    OrangeMoneyService,
    BictorysService,
  ],
  exports: [PaymentsService, WaveService, OrangeMoneyService, BictorysService],
})
export class PaymentsModule {}
