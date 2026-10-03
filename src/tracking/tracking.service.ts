import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EventSource,
  MarketingEvent,
  Order,
  Prisma,
  TrackingEventName,
  Visitor,
  VisitorSession,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildIdentity,
  hashEmail,
  hashPhone,
  normalizeSearchTerm,
  parseDevice,
  resolvePlatform,
} from './utils/identity.util';
import {
  IdentifyDto,
  PageViewDto,
  StartSessionDto,
  TrackEventsDto,
  TrackSearchDto,
} from './dto/tracking.dto';
import { MetaCapiService } from './services/meta-capi.service';

const SESSION_TIMEOUT_MINUTES = 30;

function getClientIp(request: unknown): string | undefined {
  if (!request || typeof request !== 'object') {
    return undefined;
  }
  const req = request as Record<string, any>;
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    if (Array.isArray(forwarded)) {
      return forwarded[0]?.split(',')[0]?.trim();
    }
    return String(forwarded).split(',')[0]?.trim();
  }
  return (req as any).ip || (req as any).connection?.remoteAddress;
}

function getUserAgent(request: unknown): string | undefined {
  if (!request || typeof request !== 'object') {
    return undefined;
  }
  const req = request as Record<string, any>;
  return (
    (req as any).headers?.['user-agent'] ||
    (typeof (req as any).get === 'function'
      ? (req as any).get('user-agent')
      : undefined)
  );
}

type SessionWithVisitor = VisitorSession & { visitor: Visitor };
type EventWithContext = MarketingEvent & {
  visitor?: Visitor | null;
  session?: VisitorSession | null;
  order?: Order | null;
};

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly metaCapi: MetaCapiService,
  ) {}

  private async touchSession(sessionId: string): Promise<void> {
    await this.prisma.visitorSession.update({
      where: { id: sessionId },
      data: { lastSeenAt: new Date() },
    });
  }

  private async getOrCreateVisitor(anonymousId: string): Promise<Visitor> {
    return this.prisma.visitor.upsert({
      where: { anonymousId },
      update: { lastSeenAt: new Date() },
      create: { anonymousId, lastSeenAt: new Date(), firstSeenAt: new Date() },
    });
  }

  private async resolveSession(
    sessionKey: string,
  ): Promise<SessionWithVisitor | null> {
    const session = await this.prisma.visitorSession.findFirst({
      where: { sessionKey },
      include: { visitor: true },
    });
    if (!session) {
      return null;
    }
    const now = new Date();
    const last = session.lastSeenAt;
    const diffMs = now.getTime() - last.getTime();
    if (diffMs > SESSION_TIMEOUT_MINUTES * 60 * 1000) {
      await this.prisma.visitorSession.update({
        where: { id: session.id },
        data: { endedAt: now },
      });
      return null;
    }
    return session;
  }

  async startSession(
    dto: StartSessionDto,
    request?: any,
  ): Promise<SessionWithVisitor> {
    const visitor = await this.getOrCreateVisitor(dto.anonymousId);
    const ip = getClientIp(request);
    const ua = getUserAgent(request);

    const platformRes = resolvePlatform({
      fbclid: dto.fbclid,
      gclid: dto.gclid,
      gbraid: dto.gbraid,
      wbraid: dto.wbraid,
      ttclid: dto.ttclid,
      msclkid: dto.msclkid,
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
      referrer: dto.referrer,
    });

    let referrerDomain: string | undefined;
    try {
      if (dto.referrer) {
        referrerDomain = new URL(dto.referrer).hostname.toLowerCase();
      }
    } catch {
      referrerDomain = undefined;
    }

    const session = await this.prisma.visitorSession.create({
      data: {
        visitorId: visitor.id,
        sessionKey: dto.sessionKey,
        landingPage: dto.landingPage,
        pagePath: dto.pagePath,
        referrer: dto.referrer,
        referrerDomain,
        userAgent: ua,
        device: parseDevice(ua),
        ipAddress: ip,
        utmSource: dto.utmSource,
        utmMedium: dto.utmMedium,
        utmCampaign: dto.utmCampaign,
        utmContent: dto.utmContent,
        utmTerm: dto.utmTerm,
        utmId: dto.utmId,
        fbclid: dto.fbclid,
        gclid: dto.gclid,
        gbraid: dto.gbraid,
        wbraid: dto.wbraid,
        ttclid: dto.ttclid,
        msclkid: dto.msclkid,
        clickId: platformRes.clickId,
        clickIdType: platformRes.clickIdType,
        platform: platformRes.platform,
        campaignKey: platformRes.campaignKey,
        consentGranted: dto.consentGranted,
        consentAt: dto.consentGranted ? new Date() : undefined,
        lastSeenAt: new Date(),
      },
      include: { visitor: true },
    });

    if (dto.fbc) {
      await this.prisma.visitor.update({
        where: { id: visitor.id },
        data: { fbc: dto.fbc, fbp: dto.fbp, lastSeenAt: new Date() },
      });
    } else if (dto.fbp) {
      await this.prisma.visitor.update({
        where: { id: visitor.id },
        data: { fbp: dto.fbp, lastSeenAt: new Date() },
      });
    }

    await this.createPageViewEvent(session.id, visitor.id, {
      pagePath: dto.pagePath,
      pageUrl: dto.landingPage,
      referrer: dto.referrer,
      eventTime: new Date(),
    });

    await this.recordSessionEvent(session.id, TrackingEventName.PAGE_VIEW, {
      pagePath: dto.pagePath,
      pageUrl: dto.landingPage,
      referrer: dto.referrer,
    });

    return session;
  }

  async identify(dto: IdentifyDto): Promise<Visitor> {
    const visitor = await this.getOrCreateVisitor(dto.anonymousId);

    const identity = buildIdentity({
      email: dto.email,
      phone: dto.phone,
      firstName: dto.firstName,
      lastName: dto.lastName,
      city: dto.city,
      country: dto.country,
    });

    const updateData: Prisma.VisitorUncheckedUpdateInput = {
      lastSeenAt: new Date(),
    };

    if (identity.emailHash) {
      updateData.emailHash = identity.emailHash;
    }
    if (identity.phoneHash) {
      updateData.phoneHash = identity.phoneHash;
    }
    if (dto.fbc) {
      updateData.fbc = dto.fbc;
    }
    if (dto.fbp) {
      updateData.fbp = dto.fbp;
    }
    if (dto.userId) {
      updateData.userId = dto.userId;
      await this.prisma.marketingEvent.updateMany({
        where: { visitorId: visitor.id, userId: null },
        data: { userId: dto.userId },
      });
      await this.prisma.visitorSession.updateMany({
        where: { visitorId: visitor.id },
        data: {},
      });
    }

    return this.prisma.visitor.update({
      where: { id: visitor.id },
      data: updateData,
    });
  }

  async recordPageView(dto: PageViewDto, _request?: unknown): Promise<void> {
    void _request;
    const session = await this.resolveSession(dto.sessionKey);
    if (!session) {
      return;
    }
    await this.touchSession(session.id);
    await this.createPageViewEvent(session.id, session.visitorId, {
      pagePath: dto.pagePath,
      pageUrl: dto.pageUrl,
      referrer: dto.referrer,
      eventTime: new Date(),
    });
    await this.recordSessionEvent(session.id, TrackingEventName.PAGE_VIEW, {
      pagePath: dto.pagePath,
      pageUrl: dto.pageUrl,
      referrer: dto.referrer,
    });
  }

  async recordSearch(dto: TrackSearchDto): Promise<void> {
    const session = await this.resolveSession(dto.sessionKey);
    if (!session) {
      return;
    }
    await this.touchSession(session.id);
    const normalized = normalizeSearchTerm(dto.query);

    await this.prisma.searchQuery.create({
      data: {
        query: dto.query,
        normalizedQuery: normalized,
        resultCount: dto.resultCount,
        visitorId: session.visitorId,
        sessionId: session.id,
      },
    });

    const event = await this.createEvent({
      eventId: `search-${session.id}-${Date.now()}`,
      name: TrackingEventName.SEARCH,
      sessionId: session.id,
      visitorId: session.visitorId,
      eventTime: new Date(),
      pageUrl: undefined,
      pagePath: undefined,
      referrer: undefined,
      quantity: undefined,
      value: undefined,
      productId: undefined,
      variantId: undefined,
      orderId: undefined,
      searchQuery: normalized,
    });

    await this.recordSessionEvent(session.id, TrackingEventName.SEARCH, {
      pagePath: undefined,
      pageUrl: undefined,
      referrer: undefined,
    });

    void this.dispatchMetaCapi([event], requestContextFromSession(session));
  }

  async trackEvents(dto: TrackEventsDto, _request?: unknown): Promise<void> {
    void _request;
    const session = await this.resolveSession(dto.sessionKey);
    if (!session) {
      return;
    }
    await this.touchSession(session.id);

    const events: EventWithContext[] = [];
    for (const e of dto.events) {
      const eventTime = e.eventTime ? new Date(e.eventTime) : new Date();

      const created = await this.createEvent({
        eventId: e.eventId,
        name: e.name,
        sessionId: session.id,
        visitorId: session.visitorId,
        userId: dto.userId || session.visitor.userId || undefined,
        eventTime,
        pagePath: e.pagePath,
        pageUrl: e.pageUrl,
        referrer: e.referrer,
        productId: e.productId,
        variantId: e.variantId,
        orderId: e.orderId,
        quantity: e.quantity,
        value: e.value,
        searchQuery:
          e.name === TrackingEventName.SEARCH && e.searchQuery
            ? normalizeSearchTerm(e.searchQuery)
            : undefined,
      });

      events.push(created);
      await this.recordSessionEvent(session.id, e.name, {
        pagePath: e.pagePath,
        pageUrl: e.pageUrl,
        referrer: e.referrer,
      });
    }

    if (events.length) {
      void this.dispatchMetaCapi(events, requestContextFromSession(session));
    }
  }

  async trackPurchase(orderId: string, _request?: unknown): Promise<void> {
    void _request;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, visitor: true, session: true },
    });
    if (!order) {
      return;
    }

    const visitorId = order.visitorId || order.visitor?.id;
    const sessionId = order.sessionId || order.session?.id;

    let visitor = order.visitor;
    if (visitorId) {
      visitor =
        (await this.prisma.visitor.findUnique({ where: { id: visitorId } })) ||
        visitor;
    }

    if (!visitor && order.customerEmail) {
      const emailHash = hashEmail(order.customerEmail);
      if (emailHash) {
        visitor =
          (await this.prisma.visitor.findFirst({ where: { emailHash } })) ||
          visitor;
      }
    }
    if (!visitor && order.customerPhone) {
      const phoneHash = hashPhone(order.customerPhone);
      if (phoneHash) {
        visitor =
          (await this.prisma.visitor.findFirst({ where: { phoneHash } })) ||
          visitor;
      }
    }

    const eventId = `purchase-${order.orderNumber}`;
    const existing = await this.prisma.marketingEvent.findUnique({
      where: { eventId },
    });

    if (!existing) {
      const event = await this.createEvent({
        eventId,
        name: TrackingEventName.PURCHASE,
        sessionId: sessionId || undefined,
        visitorId: visitor?.id || visitorId || undefined,
        userId: order.userId || undefined,
        orderId: order.id,
        eventTime: order.paidAt || order.deliveredAt || order.createdAt,
        value: Number(order.total),
        currency: order.currency,
        quantity: order.items.reduce((sum, i) => sum + i.quantity, 0),
        productId: order.items[0]?.productId,
        variantId: order.items[0]?.variantId || undefined,
      });

      await this.prisma.marketingEvent.update({
        where: { id: event.id },
        data: { order: { connect: { id: order.id } } },
      });

      const eventWithCtx = await this.prisma.marketingEvent.findUnique({
        where: { id: event.id },
        include: {
          visitor: true,
          session: true,
          order: { include: { items: true } },
        },
      });

      if (eventWithCtx) {
        void this.dispatchMetaCapi([eventWithCtx], {
          ipAddress: order.session?.ipAddress || undefined,
          userAgent: order.session?.userAgent || undefined,
        });
      }
    }
  }

  async trackRefund(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      return;
    }
    const eventId = `refund-${order.orderNumber}-${Date.now()}`;
    await this.createEvent({
      eventId,
      name: TrackingEventName.LEAD,
      sessionId: order.sessionId || undefined,
      visitorId: order.visitorId || undefined,
      userId: order.userId || undefined,
      orderId: order.id,
      eventTime: new Date(),
      value: Number(order.total),
      currency: order.currency,
      quantity: 0,
    });
  }

  async getEventsPendingDispatch(
    provider: 'META_CAPI' | 'GOOGLE_OFFLINE',
    limit = 20,
  ) {
    return this.prisma.marketingEvent.findMany({
      where: {
        conversions: {
          none: { provider },
        },
      },
      orderBy: { eventTime: 'asc' },
      take: limit,
      include: {
        visitor: true,
        session: true,
        order: { include: { items: true } },
      },
    });
  }

  private async createPageViewEvent(
    sessionId: string,
    visitorId: string,
    opts: {
      pagePath?: string;
      pageUrl?: string;
      referrer?: string;
      eventTime: Date;
    },
  ): Promise<MarketingEvent> {
    return this.createEvent({
      eventId: `pv-${sessionId}-${opts.eventTime.getTime()}`,
      name: TrackingEventName.PAGE_VIEW,
      sessionId,
      visitorId,
      eventTime: opts.eventTime,
      pagePath: opts.pagePath,
      pageUrl: opts.pageUrl,
      referrer: opts.referrer,
    });
  }

  private async createEvent(params: {
    eventId: string;
    name: TrackingEventName;
    sessionId?: string;
    visitorId?: string;
    userId?: string;
    orderId?: string;
    productId?: string;
    variantId?: string;
    eventTime: Date;
    value?: number;
    currency?: string;
    quantity?: number;
    pagePath?: string;
    pageUrl?: string;
    referrer?: string;
    searchQuery?: string;
  }): Promise<EventWithContext> {
    const existing = await this.prisma.marketingEvent.findUnique({
      where: { eventId: params.eventId },
      include: { visitor: true, session: true, order: true },
    });
    if (existing) {
      return existing;
    }

    const created = await this.prisma.marketingEvent.create({
      data: {
        eventId: params.eventId,
        name: params.name,
        source: EventSource.BROWSER,
        visitorId: params.visitorId,
        sessionId: params.sessionId,
        userId: params.userId,
        orderId: params.orderId,
        productId: params.productId,
        variantId: params.variantId,
        eventTime: params.eventTime,
        value: params.value ? new Prisma.Decimal(params.value) : undefined,
        currency: params.currency || 'XOF',
        quantity: params.quantity,
        pagePath: params.pagePath,
        pageUrl: params.pageUrl,
        referrer: params.referrer,
        searchQuery: params.searchQuery,
      },
      include: {
        visitor: true,
        session: true,
        order: { include: { items: true } },
      },
    });

    return created;
  }

  private async recordSessionEvent(
    sessionId: string,
    name: TrackingEventName,
    opts: {
      pagePath?: string;
      pageUrl?: string;
      referrer?: string;
      durationMs?: number;
    },
  ): Promise<void> {
    try {
      await this.prisma.visitorSessionEvent.create({
        data: {
          sessionId,
          name,
          pagePath: opts.pagePath,
          pageUrl: opts.pageUrl,
          referrer: opts.referrer,
          durationMs: opts.durationMs,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Impossible d'enregistrer VisitorSessionEvent ${name}: ${error}`,
      );
    }
  }

  private async dispatchMetaCapi(
    events: EventWithContext[],
    ctx?: { ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    if (!events.length) {
      return;
    }
    const result = await this.metaCapi.dispatch(events, ctx);
    for (const event of events) {
      try {
        await this.prisma.conversionLog.upsert({
          where: {
            eventId_provider: {
              eventId: event.id,
              provider: 'META_CAPI',
            },
          },
          update: {
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
                ? new Date(Date.now() + Math.min(60 * 60 * 1000, 5 * 60 * 1000))
                : null,
          },
          create: {
            eventId: event.id,
            provider: 'META_CAPI',
            status:
              result.status === 'sent'
                ? 'SENT'
                : result.status === 'skipped'
                  ? 'SKIPPED'
                  : 'FAILED',
            attempts: 1,
            lastError: result.error,
            responseCode: result.responseCode,
            responseBody: result.responseBody?.slice(0, 1000),
            sentAt: result.status === 'sent' ? new Date() : undefined,
            nextRetryAt:
              result.status === 'failed'
                ? new Date(Date.now() + 5 * 60 * 1000)
                : null,
          },
        });
      } catch (error) {
        this.logger.error(
          `Impossible d'enregistrer ConversionLog Meta pour ${event.id}: ${error}`,
        );
      }
    }
  }
}

function requestContextFromSession(session: SessionWithVisitor): {
  ipAddress?: string;
  userAgent?: string;
} {
  return {
    ipAddress: session.ipAddress || undefined,
    userAgent: session.userAgent || undefined,
  };
}
