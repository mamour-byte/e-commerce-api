import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MetaCapiService } from './services/meta-capi.service';
import { TikTokEventsApiService } from './services/tiktok-events-api.service';

@Injectable()
export class TrackingJobsService {
  private readonly logger = new Logger(TrackingJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaCapi: MetaCapiService,
    private readonly tiktokEventsApi: TikTokEventsApiService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryFailedMetaEvents() {
    const pending = await this.prisma.conversionLog.findMany({
      where: {
        provider: 'META_CAPI',
        status: 'FAILED',
        nextRetryAt: { lte: new Date() },
        attempts: { lt: 10 },
      },
      include: {
        event: {
          include: {
            visitor: true,
            session: true,
            order: { include: { items: true } },
          },
        },
      },
      take: 10,
    });

    for (const log of pending) {
      const event = log.event;
      const result = await this.metaCapi.dispatch([event], {
        ipAddress: event.session?.ipAddress || undefined,
        userAgent: event.session?.userAgent || undefined,
      });

      await this.prisma.conversionLog.update({
        where: { id: log.id },
        data: {
          status:
            result.status === 'sent'
              ? 'SENT'
              : result.status === 'skipped'
                ? 'SKIPPED'
                : 'FAILED',
          attempts: { increment: 1 },
          lastError: result.error,
          responseCode: result.responseCode,
          responseBody: result.responseBody?.slice(0, 1000),
          sentAt: result.status === 'sent' ? new Date() : undefined,
          nextRetryAt:
            result.status === 'failed'
              ? new Date(
                  Date.now() +
                    Math.min(
                      2 * 60 * 60 * 1000,
                      Math.pow(2, log.attempts) * 60 * 1000,
                    ),
                )
              : null,
        },
      });
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryFailedTikTokEvents() {
    const pending = await this.prisma.conversionLog.findMany({
      where: {
        provider: 'TIKTOK_EVENTS_API',
        status: 'FAILED',
        nextRetryAt: { lte: new Date() },
        attempts: { lt: 10 },
      },
      include: {
        event: {
          include: {
            visitor: true,
            session: true,
            order: { include: { items: true } },
          },
        },
      },
      take: 10,
    });

    for (const log of pending) {
      const event = log.event;
      const result = await this.tiktokEventsApi.dispatch([event], {
        ipAddress: event.session?.ipAddress || undefined,
        userAgent: event.session?.userAgent || undefined,
      });

      await this.prisma.conversionLog.update({
        where: { id: log.id },
        data: {
          status:
            result.status === 'sent'
              ? 'SENT'
              : result.status === 'skipped'
                ? 'SKIPPED'
                : 'FAILED',
          attempts: { increment: 1 },
          lastError: result.error,
          responseCode: result.responseCode,
          responseBody: result.responseBody?.slice(0, 1000),
          sentAt: result.status === 'sent' ? new Date() : undefined,
          nextRetryAt:
            result.status === 'failed'
              ? new Date(
                  Date.now() +
                    Math.min(
                      2 * 60 * 60 * 1000,
                      Math.pow(2, log.attempts) * 60 * 1000,
                    ),
                )
              : null,
        },
      });
    }
  }
}
