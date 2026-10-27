import { ConfigService } from '@nestjs/config';
import {
  EventSource,
  MarketingEvent,
  Order,
  OrderItem,
  Prisma,
  TrackingEventName,
  Visitor,
  VisitorSession,
} from '@prisma/client';
import { hashEmail, hashPhone, sha256 } from '../utils/identity.util';
import { TikTokEventsApiService } from './tiktok-events-api.service';

describe('TikTokEventsApiService', () => {
  const configValues: Record<string, string> = {
    TIKTOK_PIXEL_ID: 'pixel-code',
    TIKTOK_ACCESS_TOKEN: 'access-token',
  };
  const config = {
    get: jest.fn((key: string) => configValues[key]),
    getOrThrow: jest.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;
  const service = new TikTokEventsApiService(config);

  const createEvent = (): MarketingEvent & {
    visitor: Visitor;
    session: VisitorSession;
    order: Order & { items: OrderItem[] };
  } => ({
    id: 'database-event-id',
    eventId: 'purchase-order-42',
    name: TrackingEventName.PURCHASE,
    source: EventSource.SERVER,
    visitorId: 'visitor-id',
    sessionId: 'session-id',
    userId: 'customer-id',
    productId: 'product-id',
    variantId: 'variant-id',
    orderId: 'order-id',
    value: new Prisma.Decimal(12500),
    currency: 'XOF',
    quantity: 2,
    pagePath: '/checkout/success',
    pageUrl: 'https://store.example/checkout/success',
    referrer: 'https://store.example/cart',
    searchQuery: null,
    eventTime: new Date('2026-10-27T10:00:00.000Z'),
    createdAt: new Date('2026-10-27T10:00:00.000Z'),
    visitor: {
      id: 'visitor-id',
      userId: 'customer-id',
      emailHash: hashEmail('BUYER@example.com'),
      phoneHash: hashPhone('+221 77 123 45 67'),
      ttp: 'ttp-cookie',
    } as Visitor,
    session: {
      id: 'session-id',
      ttclid: 'click-id',
      ipAddress: '203.0.113.4',
      userAgent: 'test-agent',
      landingPage: 'https://store.example/',
      referrer: 'https://search.example/',
    } as VisitorSession,
    order: {
      id: 'order-id',
      orderNumber: 'HS-42',
      userId: 'customer-id',
      customerEmail: 'buyer@example.com',
      customerPhone: '+221771234567',
      items: [
        {
          productId: 'product-id',
          variantId: 'variant-id',
          sku: 'SKU-42',
          productName: 'Product 42',
          quantity: 2,
          unitPrice: new Prisma.Decimal(6250),
        } as OrderItem,
      ],
    } as Order & { items: OrderItem[] },
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds a hashed CompletePayment event with order items and TikTok click data', () => {
    const payload = service.buildEvent(createEvent());

    expect(payload).toMatchObject({
      pixel_code: 'pixel-code',
      event: 'CompletePayment',
      event_id: 'purchase-order-42',
      timestamp: '2026-10-27T10:00:00.000Z',
      context: {
        page: {
          url: 'https://store.example/checkout/success',
          referrer: 'https://store.example/cart',
        },
        user: {
          email: hashEmail('BUYER@example.com'),
          phone_number: hashPhone('+221 77 123 45 67'),
          external_id: sha256('customer-id'),
          ip: '203.0.113.4',
          user_agent: 'test-agent',
          ttclid: 'click-id',
          ttp: 'ttp-cookie',
        },
      },
      properties: {
        value: 12500,
        currency: 'XOF',
        order_id: 'HS-42',
        content_type: 'product',
        content_ids: ['SKU-42'],
        contents: [
          {
            content_id: 'SKU-42',
            content_type: 'product',
            content_name: 'Product 42',
            quantity: 2,
            price: 6250,
          },
        ],
      },
    });
  });

  it('posts the event with the private access token and records TikTok success', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"code":0}'),
    } as Response);

    await expect(service.dispatch([createEvent()])).resolves.toMatchObject({
      status: 'sent',
      responseCode: 200,
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://business-api.tiktok.com/open_api/v1.3/event/track/',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Access-Token': 'access-token',
        },
      }),
    );
    const requestBody = JSON.parse(fetch.mock.calls[0][1]?.body as string) as {
      event_id?: string;
    };
    expect(requestBody.event_id).toBe('purchase-order-42');
  });

  it('skips dispatch if the access token is not configured', async () => {
    configValues.TIKTOK_ACCESS_TOKEN = '';

    await expect(service.dispatch([createEvent()])).resolves.toMatchObject({
      status: 'skipped',
    });
  });
});
