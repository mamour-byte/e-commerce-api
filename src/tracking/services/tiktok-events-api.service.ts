import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MarketingEvent,
  Order,
  OrderItem,
  TrackingEventName,
  Visitor,
  VisitorSession,
} from '@prisma/client';
import { hashEmail, hashPhone, sha256 } from '../utils/identity.util';

type TikTokEventWithContext = MarketingEvent & {
  visitor?: Visitor | null;
  session?: VisitorSession | null;
  order?: (Order & { items?: OrderItem[] }) | null;
};

interface TikTokUser {
  email?: string;
  phone_number?: string;
  external_id?: string;
  ip?: string;
  user_agent?: string;
  ttclid?: string;
  ttp?: string;
}

interface TikTokEventPayload {
  pixel_code: string;
  event: string;
  event_id: string;
  timestamp: string;
  context: {
    page?: { url?: string; referrer?: string };
    user?: TikTokUser;
  };
  properties?: Record<string, unknown>;
}

export interface TikTokDispatchResult {
  status: 'sent' | 'skipped' | 'failed';
  responseCode?: number;
  responseBody?: string;
  error?: string;
}

const TIKTOK_EVENT_NAMES: Partial<Record<TrackingEventName, string>> = {
  PAGE_VIEW: 'PageView',
  VIEW_CONTENT: 'ViewContent',
  ADD_TO_CART: 'AddToCart',
  ADD_TO_WISHLIST: 'AddToWishlist',
  INITIATE_CHECKOUT: 'InitiateCheckout',
  ADD_PAYMENT_INFO: 'AddPaymentInfo',
  PURCHASE: 'CompletePayment',
  SEARCH: 'Search',
  LEAD: 'SubmitForm',
  SUBSCRIBE: 'Subscribe',
};

@Injectable()
export class TikTokEventsApiService {
  private readonly logger = new Logger(TikTokEventsApiService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('TIKTOK_PIXEL_ID') &&
      this.config.get<string>('TIKTOK_ACCESS_TOKEN'),
    );
  }

  buildEvent(
    event: TikTokEventWithContext,
    requestContext?: { ipAddress?: string; userAgent?: string },
  ): TikTokEventPayload | null {
    const eventName = TIKTOK_EVENT_NAMES[event.name];
    if (!eventName) return null;

    const visitor = event.visitor;
    const order = event.order;
    const user: TikTokUser = {};
    const email =
      visitor?.emailHash ||
      (order?.customerEmail ? hashEmail(order.customerEmail) : undefined);
    const phone =
      visitor?.phoneHash ||
      (order?.customerPhone ? hashPhone(order.customerPhone) : undefined);
    const externalId =
      visitor?.userId || event.userId || order?.userId || visitor?.id;

    if (email) user.email = email;
    if (phone) user.phone_number = phone;
    if (externalId) user.external_id = sha256(externalId.trim().toLowerCase());
    if (requestContext?.ipAddress || event.session?.ipAddress) {
      user.ip =
        requestContext?.ipAddress || event.session?.ipAddress || undefined;
    }
    if (requestContext?.userAgent || event.session?.userAgent) {
      user.user_agent =
        requestContext?.userAgent || event.session?.userAgent || undefined;
    }
    if (event.session?.ttclid) user.ttclid = event.session.ttclid;
    if (visitor?.ttp) user.ttp = visitor.ttp;

    const properties: Record<string, unknown> = {};
    if (event.value !== null && event.value !== undefined) {
      properties.value = Number(event.value);
      properties.currency = event.currency || 'XOF';
    }
    if (event.orderId && order) properties.order_id = order.orderNumber;
    if (order?.items?.length) {
      properties.contents = order.items.map((item) => ({
        content_id: item.sku || item.variantId || item.productId,
        content_type: 'product',
        content_name: item.productName,
        quantity: item.quantity,
        price: Number(item.unitPrice),
      }));
      properties.content_type = 'product';
      properties.content_ids = order.items.map(
        (item) => item.sku || item.variantId || item.productId,
      );
    } else if (event.productId) {
      const contentId = event.variantId || event.productId;
      properties.contents = [
        {
          content_id: contentId,
          content_type: 'product',
          quantity: event.quantity || 1,
          ...(event.value !== null && event.value !== undefined
            ? { price: Number(event.value) }
            : {}),
        },
      ];
      properties.content_type = 'product';
      properties.content_ids = [contentId];
    } else if (event.quantity !== null && event.quantity !== undefined) {
      properties.quantity = event.quantity;
    }

    return {
      pixel_code: this.config.getOrThrow<string>('TIKTOK_PIXEL_ID'),
      event: eventName,
      event_id: event.eventId,
      timestamp: event.eventTime.toISOString(),
      context: {
        page: {
          url: event.pageUrl || event.session?.landingPage || undefined,
          referrer: event.referrer || event.session?.referrer || undefined,
        },
        ...(Object.keys(user).length ? { user } : {}),
      },
      ...(Object.keys(properties).length ? { properties } : {}),
    };
  }

  async dispatch(
    events: TikTokEventWithContext[],
    requestContext?: { ipAddress?: string; userAgent?: string },
  ): Promise<TikTokDispatchResult> {
    if (!events.length) {
      return { status: 'skipped', error: 'Aucun evenement a envoyer.' };
    }
    if (!this.isConfigured()) {
      return {
        status: 'skipped',
        error: 'TIKTOK_PIXEL_ID ou TIKTOK_ACCESS_TOKEN non configure.',
      };
    }

    const payloads = events
      .map((event) => this.buildEvent(event, requestContext))
      .filter((payload): payload is TikTokEventPayload => payload !== null);
    if (!payloads.length) {
      return { status: 'skipped', error: 'Aucun evenement TikTok mappable.' };
    }

    let responseCode: number | undefined;
    let responseBody: string | undefined;
    try {
      for (const payload of payloads) {
        const response = await fetch(
          'https://business-api.tiktok.com/open_api/v1.3/event/track/',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Access-Token': this.config.getOrThrow<string>(
                'TIKTOK_ACCESS_TOKEN',
              ),
            },
            body: JSON.stringify(payload),
          },
        );
        responseCode = response.status;
        responseBody = await response.text();

        if (!response.ok) {
          this.logger.error(
            `TikTok Events API refuse l'evenement ${payload.event} (HTTP ${response.status}).`,
          );
          return {
            status: 'failed',
            responseCode,
            responseBody,
            error: `HTTP ${response.status}`,
          };
        }

        const result = JSON.parse(responseBody) as { code?: number };
        if (typeof result.code === 'number' && result.code !== 0) {
          this.logger.error(
            `TikTok Events API refuse l'evenement ${payload.event} (code ${result.code}).`,
          );
          return {
            status: 'failed',
            responseCode,
            responseBody,
            error: `TikTok API code ${result.code}`,
          };
        }
      }

      return { status: 'sent', responseCode, responseBody };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Echec d'appel a TikTok Events API : ${message}`);
      return { status: 'failed', responseCode, responseBody, error: message };
    }
  }
}
