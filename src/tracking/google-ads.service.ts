import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GoogleAdsService {
  private readonly logger = new Logger(GoogleAdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('GOOGLE_ADS_CUSTOMER_ID') &&
      this.config.get<string>('GOOGLE_ADS_DEVELOPER_TOKEN') &&
      this.config.get<string>('GOOGLE_ADS_ACCESS_TOKEN'),
    );
  }
}
