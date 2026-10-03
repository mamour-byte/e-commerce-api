import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EventSource,
  MarketingEvent,
  Order,
  OrderItem,
  TrackingEventName,
  Visitor,
} from '@prisma/client';

const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || 'v22.0';

export interface MetaUserData {
  em?: string[];
  ph?: string[];
  fn?: string;
  ln?: string;
  city?: string;
  country?: string;
  external_id?: string;
  client_ip_address?: string;
  client_user_agent?: string;
  fbc?: string;
  fbp?: string;
}

export interface MetaCustomData {
  currency?: string;
  value?: number;
  content_ids?: string[];
  content_type?: string;
  content_name?: string;
  num_items?: number;
  order_id?: string;
  search_string?: string;
}

export interface MetaServerEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  event_source_url?: string;
  action_source: 'website' | 'app' | 'offline_conversion';
  user_data: MetaUserData;
  custom_data?: MetaCustomData;
}

export interface MetaDispatchResult {
  status: 'sent' | 'skipped' | 'failed';
  responseCode?: number;
  responseBody?: string;
  error?: string;
}

type TrackingEventWithContext = MarketingEvent & {
  visitor?: Visitor | null;
  order?: (Order & { items?: OrderItem[] }) | null;
};

const META_EVENT_NAME_MAP: Partial<Record<TrackingEventName, string>> = {
  PAGE_VIEW: 'PageView',
  VIEW_CONTENT: 'ViewContent',
  ADD_TO_CART: 'AddToCart',
  ADD_TO_WISHLIST: 'AddToWishlist',
  INITIATE_CHECKOUT: 'InitiateCheckout',
  ADD_PAYMENT_INFO: 'AddPaymentInfo',
  PURCHASE: 'Purchase',
  SEARCH: 'Search',
  LEAD: 'Lead',
  SUBSCRIBE: 'Subscribe',
};

@Injectable()
export class MetaCapiService {
  private readonly logger = new Logger(MetaCapiService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('META_PIXEL_ID') &&
      this.config.get<string>('META_CAPI_ACCESS_TOKEN'),
    );
  }

  private get pixelId(): string {
    return this.config.getOrThrow<string>('META_PIXEL_ID');
  }

  private get accessToken(): string {
    return this.config.getOrThrow<string>('META_CAPI_ACCESS_TOKEN');
  }

  buildEvent(event: TrackingEventWithContext): MetaServerEvent | null {
    const metaEventName = META_EVENT_NAME_MAP[event.name];
    if (!metaEventName) {
      return null;
    }

    const visitor = event.visitor;
    const order = event.order;

    const userData: MetaUserData = {
      external_id: visitor?.id,
    };

    if (visitor?.emailHash) {
      userData.em = [visitor.emailHash];
    }
    if (visitor?.phoneHash) {
      userData.ph = [visitor.phoneHash];
    }
    if (visitor?.fbc) {
      userData.fbc = visitor.fbc;
    }
    if (visitor?.fbp) {
      userData.fbp = visitor.fbp;
    }
    if (visitor?.userId) {
      userData.external_id = visitor.userId;
    }
    if (order) {
      userData.country = order.shippingCountry;
    }

    const customData: MetaCustomData = {
      currency: event.currency,
    };

    if (event.value !== null && event.value !== undefined) {
      customData.value = Number(event.value);
    }
    if (event.productId) {
      customData.content_ids = [event.variantId || event.productId];
      customData.content_type = 'product';
    }
    if (event.quantity) {
      customData.num_items = event.quantity;
    }
    if (event.name === TrackingEventName.PURCHASE && order) {
      customData.order_id = order.orderNumber;
      customData.content_ids = order.items?.length
        ? order.items.map((item) => item.sku || item.productId)
        : undefined;
      customData.num_items = order.items?.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
    }
    if (
      event.name === TrackingEventName.SEARCH &&
      'searchQuery' in (event as unknown as Record<string, unknown>)
    ) {
      const sq = (event as unknown as { searchQuery?: string }).searchQuery;
      if (sq) {
        customData.search_string = sq;
      }
    }

    return {
      event_name: metaEventName,
      event_time: Math.floor(event.eventTime.getTime() / 1000),
      event_id: event.eventId,
      event_source_url: event.pageUrl || undefined,
      action_source: 'website',
      user_data: userData,
      custom_data: customData,
    };
  }

  async dispatch(
    events: TrackingEventWithContext[],
    requestContext?: {
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<MetaDispatchResult> {
    if (!events.length) {
      return { status: 'skipped', error: 'Aucun evenement a envoyer.' };
    }

    if (!this.isConfigured()) {
      return {
        status: 'skipped',
        error: 'META_PIXEL_ID ou META_CAPI_ACCESS_TOKEN non configure.',
      };
    }

    const data: MetaServerEvent[] = [];
    for (const event of events) {
      const payload = this.buildEvent(event);
      if (payload) {
        data.push(payload);
      }
    }

    if (!data.length) {
      return { status: 'skipped', error: 'Aucun evenement mappable.' };
    }

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${this.pixelId}/events`;

    for (const payload of data) {
      if (!payload.user_data.client_ip_address && requestContext?.ipAddress) {
        payload.user_data.client_ip_address = requestContext.ipAddress;
      }
      if (!payload.user_data.client_user_agent && requestContext?.userAgent) {
        payload.user_data.client_user_agent = requestContext.userAgent;
      }
    }

    const body: Record<string, unknown> = {
      data,
      access_token: this.accessToken,
    };

    const testEventCode = this.config.get<string>('META_TEST_EVENT_CODE');
    if (testEventCode) {
      body.test_event_code = testEventCode;
    }

    let responseCode: number | undefined;
    let responseBody: string | undefined;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      responseCode = response.status;
      responseBody = await response.text();

      if (!response.ok) {
        this.logger.error(
          `Meta CAPI refuse ${data.length} evenement(s) (HTTP ${response.status}) : ${responseBody}`,
        );
        return {
          status: 'failed',
          responseCode,
          responseBody,
          error: `HTTP ${response.status}`,
        };
      }

      return { status: 'sent', responseCode, responseBody };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Echec d'appel a Meta Conversions API : ${message}`);
      return { status: 'failed', error: message };
    }
  }

  async testConnection(): Promise<MetaDispatchResult> {
    if (!this.isConfigured()) {
      return {
        status: 'skipped',
        error: 'META_PIXEL_ID ou META_CAPI_ACCESS_TOKEN non configure.',
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const payload: MetaServerEvent = {
      event_name: 'PageView',
      event_time: now,
      event_id: `test-${now}`,
      action_source: 'website',
      user_data: {},
    };

    try {
      const response = await fetch(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${this.pixelId}/events`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: [payload],
            access_token: this.accessToken,
          }),
        },
      );

      const body = await response.text();
      return {
        status: response.ok ? 'sent' : 'failed',
        responseCode: response.status,
        responseBody: body,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: 'failed', error: message };
    }
  }
}
