import { BadRequestException, Injectable } from '@nestjs/common';
import {
  OrderCancelReason,
  OrderStatus,
  PaymentStatus,
  Prisma,
  TrafficPlatform,
  TrackingEventName,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MarketingGroupBy, MarketingQueryDto } from './dto/marketing-query.dto';

type DateRange = {
  startDate: Date;
  endDate: Date;
  where: Prisma.DateTimeFilter;
};

const SALE_ORDER_STATUSES = [
  OrderStatus.CONFIRMED,
  OrderStatus.IN_DELIVERY,
  OrderStatus.DELIVERED,
];

const CANCELABLE_REFUSED = [
  OrderCancelReason.COD_REFUSAL,
  OrderCancelReason.CUSTOMER_REQUEST,
  OrderCancelReason.DELIVERY_FAILED,
  OrderCancelReason.OUT_OF_STOCK,
  OrderCancelReason.PAYMENT_FAILED,
  OrderCancelReason.ADMIN,
  OrderCancelReason.OTHER,
];

@Injectable()
export class MarketingService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(query: MarketingQueryDto) {
    const range = this.resolveDateRange(query);
    const baseOrderWhere = this.buildRevenueOrderWhere(range, query);

    const [
      revenueAgg,
      ordersCount,
      cancelledRefused,
      sessionsCount,
      adSpendAgg,
      metaCapiSent,
    ] = await Promise.all([
      this.prisma.order.aggregate({
        where: baseOrderWhere,
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.order.count({ where: baseOrderWhere }),
      this.prisma.order.count({
        where: {
          createdAt: range.where,
          OR: [
            { status: OrderStatus.CANCELLED },
            { status: OrderStatus.REFUNDED },
            { cancelReason: { in: CANCELABLE_REFUSED } },
          ],
        },
      }),
      this.prisma.visitorSession.count({ where: { startedAt: range.where } }),
      this.prisma.adDailyStat.aggregate({
        where: {
          date: {
            gte: new Date(range.startDate.toISOString().slice(0, 10)),
            lte: new Date(range.endDate.toISOString().slice(0, 10)),
          },
        },
        _sum: { spend: true },
      }),
      this.prisma.conversionLog.count({
        where: {
          provider: 'META_CAPI',
          status: 'SENT',
          sentAt: range.where,
        },
      }),
    ]);

    const revenue = Number(revenueAgg._sum.total || 0);
    const spend = Number(adSpendAgg._sum.spend || 0);
    const aov = ordersCount ? revenue / ordersCount : 0;
    const roas = spend > 0 ? revenue / spend : 0;
    const cancelRate =
      ordersCount + cancelledRefused > 0
        ? (cancelledRefused / (ordersCount + cancelledRefused)) * 100
        : 0;

    return {
      range: this.formatRange(range),
      revenue,
      orders: ordersCount,
      aov,
      spend,
      roas,
      cancelRate,
      sessions: sessionsCount,
      metaCapiSent,
    };
  }

  async getPlatformComparison(query: MarketingQueryDto) {
    const range = this.resolveDateRange(query);
    const baseWhere = this.buildRevenueOrderWhere(range, query);

    const [orders, adSpend] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['lastTouchPlatform'],
        where: { ...baseWhere, lastTouchPlatform: { not: null } },
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.adDailyStat.groupBy({
        by: ['campaignId'],
        where: {
          date: {
            gte: new Date(range.startDate.toISOString().slice(0, 10)),
            lte: new Date(range.endDate.toISOString().slice(0, 10)),
          },
        },
        _sum: { spend: true },
      }),
    ]);

    const campaignIds = adSpend.map((s) => s.campaignId);
    const campaigns = campaignIds.length
      ? await this.prisma.adCampaign.findMany({
          where: { id: { in: campaignIds } },
        })
      : [];

    const spendByPlatform = new Map<TrafficPlatform, number>();
    for (const s of adSpend) {
      const c = campaigns.find((x) => x.id === s.campaignId);
      if (!c) continue;
      const key = c.platform;
      spendByPlatform.set(
        key,
        (spendByPlatform.get(key) || 0) + Number(s._sum.spend || 0),
      );
    }

    const data = (Object.values(TrafficPlatform) as TrafficPlatform[]).map(
      (platform) => {
        const o = orders.find((x) => x.lastTouchPlatform === platform);
        const revenue = Number(o?._sum.total || 0);
        const ordersCount = o?._count._all || 0;
        const spend = spendByPlatform.get(platform) || 0;
        const roas = spend > 0 ? revenue / spend : 0;
        return { platform, revenue, orders: ordersCount, spend, roas };
      },
    );

    return { range: this.formatRange(range), data };
  }

  async getFunnel(query: MarketingQueryDto) {
    const range = this.resolveDateRange(query);
    const sessions = await this.prisma.visitorSession.count({
      where: { startedAt: range.where },
    });

    const [pageViews, addToCart, initiateCheckout, purchases] =
      await Promise.all([
        this.prisma.marketingEvent.count({
          where: {
            name: TrackingEventName.PAGE_VIEW,
            eventTime: range.where,
          },
        }),
        this.prisma.marketingEvent.count({
          where: {
            name: TrackingEventName.ADD_TO_CART,
            eventTime: range.where,
          },
        }),
        this.prisma.marketingEvent.count({
          where: {
            name: TrackingEventName.INITIATE_CHECKOUT,
            eventTime: range.where,
          },
        }),
        this.prisma.order.count({
          where: this.buildRevenueOrderWhere(range, query),
        }),
      ]);

    const calc = (n: number) => (sessions > 0 ? (n / sessions) * 100 : 0);
    return {
      range: this.formatRange(range),
      sessions,
      pageViews,
      addToCart,
      initiateCheckout,
      purchases,
      crPageViewToPurchase: calc(purchases),
      crAtcToPurchase:
        sessions > 0 ? (purchases / Math.max(1, addToCart)) * 100 : 0,
    };
  }

  async getTimeline(query: MarketingQueryDto) {
    const range = this.resolveDateRange(query);
    const groupBy = query.groupBy || MarketingGroupBy.DAY;
    const orders = await this.prisma.order.findMany({
      where: this.buildRevenueOrderWhere(range, query),
      select: { createdAt: true, total: true },
      orderBy: { createdAt: 'asc' },
    });

    const map = new Map<
      string,
      { date: string; revenue: number; orders: number }
    >();
    for (const o of orders) {
      const key = this.getBucket(o.createdAt, groupBy);
      const cur = map.get(key) || { date: key, revenue: 0, orders: 0 };
      cur.revenue += Number(o.total);
      cur.orders += 1;
      map.set(key, cur);
    }

    return Array.from(map.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }

  private getBucket(date: Date, groupBy: MarketingGroupBy): string {
    const d = new Date(date);
    if (groupBy === MarketingGroupBy.MONTH) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
    if (groupBy === MarketingGroupBy.WEEK) {
      const onejan = new Date(d.getFullYear(), 0, 1);
      const week = Math.ceil(
        ((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7,
      );
      return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
    }
    return d.toISOString().slice(0, 10);
  }

  private resolveDateRange(query: MarketingQueryDto): DateRange {
    const endDate = query.endDate ? new Date(query.endDate) : new Date();
    const startDate = query.startDate
      ? new Date(query.startDate)
      : new Date(endDate.getTime() - 29 * 24 * 60 * 60 * 1000);

    startDate.setUTCHours(0, 0, 0, 0);
    endDate.setUTCHours(23, 59, 59, 999);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('Les dates fournies sont invalides.');
    }
    if (startDate > endDate) {
      throw new BadRequestException(
        'La date de debut doit etre inferieure ou egale a la date de fin.',
      );
    }

    return {
      startDate,
      endDate,
      where: { gte: startDate, lte: endDate },
    };
  }

  private buildRevenueOrderWhere(
    range: DateRange,
    query: MarketingQueryDto,
  ): Prisma.OrderWhereInput {
    return {
      createdAt: range.where,
      status: { in: SALE_ORDER_STATUSES },
      paymentStatus: PaymentStatus.PAID,
      ...(query.platform ? { lastTouchPlatform: query.platform } : {}),
    };
  }

  private formatRange(range: DateRange) {
    return {
      startDate: range.startDate.toISOString(),
      endDate: range.endDate.toISOString(),
    };
  }
}
