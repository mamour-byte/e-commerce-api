import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaveService } from './providers/wave.service';
import { OrangeMoneyService } from './providers/orange-money.service';
import { BictorysService } from './providers/bictorys.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TrackingService } from '../tracking/tracking.service';
import { ConfigService } from '@nestjs/config';

describe('PaymentsService', () => {
  let service: PaymentsService;

  // Objet passé aux callbacks de $transaction (évite toute référence circulaire).
  const mockTx = {
    payment: { update: jest.fn(), updateMany: jest.fn() },
    order: { update: jest.fn(), updateMany: jest.fn() },
  };

  const mockPrismaService = {
    payment: {
      create: jest.fn<Promise<unknown>, [unknown]>(),
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      findUnique: jest.fn<Promise<unknown>, [unknown]>(),
      findMany: jest.fn<Promise<unknown>, [unknown]>(),
      update: jest.fn<Promise<unknown>, [unknown]>(),
      updateMany: jest.fn<Promise<{ count: number }>, [unknown]>(),
    },
    order: {
      findUnique: jest.fn<Promise<unknown>, [unknown]>(),
      findFirst: jest.fn<Promise<unknown>, [unknown]>(),
      update: jest.fn<Promise<unknown>, [unknown]>(),
      updateMany: jest.fn<Promise<{ count: number }>, [unknown]>(),
    },
    orderItem: {
      findMany: jest.fn<Promise<unknown>, [unknown]>(),
    },
    $transaction: jest.fn<
      Promise<unknown>,
      [(tx: unknown) => Promise<unknown>]
    >((cb) => cb(mockTx)),
  };

  const mockWaveService = {
    createCheckoutSession: jest.fn(),
    verifyWebhookSignature: jest.fn(),
  };

  const mockOrangeMoneyService = {
    initiateWebPayment: jest.fn(),
  };

  const mockBictorysService = {
    isConfigured: true,
    createCheckoutSession: jest.fn(),
    getTransaction: jest.fn(),
    verifyWebhookSecret: jest.fn(),
    isSuccessfulStatus: jest.fn(),
    isFailedStatus: jest.fn(),
    isExpiredStatus: jest.fn(),
  };

  const mockMailService = {
    sendOrderReceipt: jest.fn(),
    sendPaymentConfirmation: jest.fn(),
  };

  const mockNotificationsService = {
    notifyPaymentReceived: jest.fn(),
  };

  const mockTrackingService = {
    trackPurchase: jest.fn(),
  };

  let configValues: Record<string, string | undefined> = {};

  const mockConfigService = {
    get: jest.fn((key: string) => configValues[key]),
  };

  const providers = [
    PaymentsService,
    { provide: PrismaService, useValue: mockPrismaService },
    { provide: WaveService, useValue: mockWaveService },
    { provide: OrangeMoneyService, useValue: mockOrangeMoneyService },
    { provide: BictorysService, useValue: mockBictorysService },
    { provide: MailService, useValue: mockMailService },
    { provide: NotificationsService, useValue: mockNotificationsService },
    { provide: TrackingService, useValue: mockTrackingService },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    configValues = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ...providers,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildCheckoutRedirectTarget', () => {
    async function buildService(env: Record<string, string | undefined>) {
      configValues = env;
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ...providers,
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();
      return module.get<PaymentsService>(PaymentsService);
    }

    it('redirige vers le front local déclaré dans FRONTEND_BROWSER_URL', async () => {
      const localService = await buildService({
        FRONTEND_BROWSER_URL: 'http://localhost:5173',
      });

      const target = localService.buildCheckoutRedirectTarget('success', {
        orderId: 'order_1',
        orderNumber: 'ORD-20261022-ABCDE',
      });

      expect(target).toBe(
        'http://localhost:5173/checkout/success?orderId=order_1&orderNumber=ORD-20261022-ABCDE',
      );
    });

    it('replie sur FRONTEND_URL quand FRONTEND_BROWSER_URL est absent', async () => {
      const prodService = await buildService({
        FRONTEND_URL: 'https://hayat-sn.store',
      });

      const target = prodService.buildCheckoutRedirectTarget('failed', {
        orderId: 'order_1',
      });

      expect(target).toBe(
        'https://hayat-sn.store/checkout/failed?orderId=order_1',
      );
    });

    it('refuse une étape de redirection inconnue', () => {
      expect(() =>
        service.buildCheckoutRedirectTarget('pirate', { orderId: 'order_1' }),
      ).toThrow(NotFoundException);
    });
  });
});
