import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { OrderStatus, PaymentProvider, PaymentStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaveService } from './providers/wave.service';
import { OrangeMoneyService } from './providers/orange-money.service';
import {
  BictorysApiError,
  BictorysService,
} from './providers/bictorys.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TrackingService } from '../tracking/tracking.service';

const ORDER_ID = 'order_1';
const ORDER_NUMBER = 'ORD-20260101-ABCDE';

type OrderRecord = {
  id: string;
  orderNumber: string;
  userId: string | null;
  total: number;
  currency: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
};

type PaymentRecord = {
  id: string;
  orderId: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  transactionId: string | null;
  providerReference: string;
  amount: number;
  currency: string;
  metadata: Record<string, unknown>;
  order: OrderRecord;
};

/** Derniers arguments reçus par un mock, typés sans passer par `any`. */
function lastCallArgs(mock: jest.Mock): Record<string, unknown> {
  const calls = mock.mock.calls as unknown[][];
  const last = calls[calls.length - 1];
  return (last?.[0] ?? {}) as Record<string, unknown>;
}

describe('PaymentsService — flux Bictorys', () => {
  let service: PaymentsService;

  const order: OrderRecord = {
    id: ORDER_ID,
    orderNumber: ORDER_NUMBER,
    userId: null,
    total: 15000,
    currency: 'XOF',
    status: OrderStatus.PENDING,
    paymentStatus: PaymentStatus.PROCESSING,
  };

  const payment: PaymentRecord = {
    id: 'pay_1',
    orderId: ORDER_ID,
    provider: PaymentProvider.BICTORYS,
    status: PaymentStatus.PENDING,
    transactionId: null,
    providerReference: ORDER_NUMBER,
    amount: 15000,
    currency: 'XOF',
    metadata: { paymentReference: ORDER_NUMBER, merchantReference: ORDER_ID },
    order,
  };

  const mockPrismaService = {
    payment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    orderItem: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const mockBictorysService = {
    isConfigured: true,
    createCheckoutSession: jest.fn(),
    getTransaction: jest.fn(),
    verifyWebhookSecret: jest.fn(),
    isSuccessfulStatus: jest.fn(),
    isFailedStatus: jest.fn(),
    isTransactionReadForbidden: jest.fn(),
  };

  const mockMailService = {
    sendPaymentConfirmation: jest.fn(),
    sendOrderReceipt: jest.fn(),
  };

  const mockNotificationsService = {
    notifyPaymentReceived: jest.fn(),
  };

  const mockTrackingService = {
    trackPurchase: jest.fn(),
  };

  const webhookPayload = {
    id: 'tx_1',
    status: 'succeeded',
    amount: 15000,
    currency: 'XOF',
    paymentReference: ORDER_NUMBER,
    merchantReference: ORDER_ID,
    pspName: 'wave',
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockBictorysService.verifyWebhookSecret.mockReturnValue(true);
    mockBictorysService.isSuccessfulStatus.mockImplementation(
      (status: string) =>
        ['succeeded', 'authorized'].includes(String(status).toLowerCase()),
    );
    mockBictorysService.isFailedStatus.mockImplementation((status: string) =>
      ['failed', 'cancelled', 'canceled', 'reversed', 'expired'].includes(
        String(status).toLowerCase(),
      ),
    );
    mockBictorysService.getTransaction.mockResolvedValue({
      id: 'tx_1',
      status: 'succeeded',
      amount: 15000,
      currency: 'XOF',
      paymentReference: ORDER_NUMBER,
      merchantReference: ORDER_ID,
      pspName: 'wave',
      raw: {},
    });
    mockBictorysService.isTransactionReadForbidden.mockReturnValue(false);

    mockPrismaService.payment.findFirst.mockResolvedValue(payment);
    mockPrismaService.payment.findUnique.mockResolvedValue(payment);
    mockPrismaService.payment.update.mockResolvedValue(payment);
    mockPrismaService.payment.updateMany.mockResolvedValue({ count: 1 });
    mockPrismaService.order.findUnique.mockResolvedValue(order);
    mockPrismaService.order.update.mockResolvedValue({});
    mockPrismaService.order.updateMany.mockResolvedValue({ count: 1 });
    // La transaction est rejouée sur un faux objet tx.
    mockPrismaService.$transaction.mockImplementation(
      async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          payment: mockPrismaService.payment,
          order: mockPrismaService.order,
        }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: WaveService, useValue: {} },
        { provide: OrangeMoneyService, useValue: {} },
        { provide: BictorysService, useValue: mockBictorysService },
        { provide: MailService, useValue: mockMailService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: TrackingService, useValue: mockTrackingService },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('refuse le webhook si la clé secrète est invalide', async () => {
    mockBictorysService.verifyWebhookSecret.mockReturnValue(false);

    await expect(
      service.handleBictorysWebhook(webhookPayload, 'mauvais'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(mockPrismaService.payment.updateMany).not.toHaveBeenCalled();
    expect(mockPrismaService.order.update).not.toHaveBeenCalled();
  });

  it('ne confirme pas si le statut de la transaction n’est pas un succès', async () => {
    mockBictorysService.getTransaction.mockResolvedValue({
      id: 'tx_1',
      status: 'pending',
      amount: 15000,
      currency: 'XOF',
      raw: {},
    });

    const result = await service.handleBictorysWebhook(
      webhookPayload,
      'secret',
    );

    expect(result.confirmed).toBe(false);
    expect(mockPrismaService.payment.updateMany).not.toHaveBeenCalled();
    expect(mockPrismaService.order.update).not.toHaveBeenCalled();
  });

  it('ne confirme pas si le montant payé est inférieur au total de la commande', async () => {
    mockBictorysService.getTransaction.mockResolvedValue({
      id: 'tx_1',
      status: 'succeeded',
      amount: 1000,
      currency: 'XOF',
      raw: {},
    });

    const result = await service.handleBictorysWebhook(
      webhookPayload,
      'secret',
    );

    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain('inférieur au total');
    expect(mockPrismaService.payment.updateMany).not.toHaveBeenCalled();
  });

  it('ne confirme pas si la devise ne correspond pas', async () => {
    mockBictorysService.getTransaction.mockResolvedValue({
      id: 'tx_1',
      status: 'succeeded',
      amount: 15000,
      currency: 'EUR',
      raw: {},
    });

    const result = await service.handleBictorysWebhook(
      webhookPayload,
      'secret',
    );

    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain('Devise');
    expect(mockPrismaService.payment.updateMany).not.toHaveBeenCalled();
  });

  it('confirme la commande après vérification serveur de la transaction', async () => {
    const result = await service.handleBictorysWebhook(
      webhookPayload,
      'secret',
    );

    expect(result.confirmed).toBe(true);
    expect(mockBictorysService.getTransaction).toHaveBeenCalledWith('tx_1');

    const updateManyArgs = lastCallArgs(mockPrismaService.payment.updateMany);
    expect(updateManyArgs.where).toEqual({
      id: 'pay_1',
      status: { not: PaymentStatus.PAID },
    });
    expect((updateManyArgs.data as { status: PaymentStatus }).status).toBe(
      PaymentStatus.PAID,
    );

    const orderArgs = lastCallArgs(mockPrismaService.order.update);
    expect(orderArgs.where).toEqual({ id: ORDER_ID });
    const orderData = orderArgs.data as {
      paymentStatus: PaymentStatus;
      status: OrderStatus;
    };
    expect(orderData.paymentStatus).toBe(PaymentStatus.PAID);
    expect(orderData.status).toBe(OrderStatus.CONFIRMED);

    expect(mockNotificationsService.notifyPaymentReceived).toHaveBeenCalled();
    expect(mockTrackingService.trackPurchase).toHaveBeenCalledWith(ORDER_ID);
  });

  it('marque le paiement en échec si Bictorys signale un échec', async () => {
    const result = await service.handleBictorysWebhook(
      { ...webhookPayload, status: 'failed' },
      'secret',
    );

    expect(result.confirmed).toBe(false);

    const updateArgs = lastCallArgs(mockPrismaService.payment.update);
    expect(updateArgs.where).toEqual({ id: 'pay_1' });
    expect((updateArgs.data as { status: PaymentStatus }).status).toBe(
      PaymentStatus.FAILED,
    );

    const orderArgs = lastCallArgs(mockPrismaService.order.updateMany);
    expect(orderArgs.data).toEqual({ paymentStatus: PaymentStatus.FAILED });
  });

  it('ignore un webhook sans correspondance sans modifier la base', async () => {
    mockPrismaService.payment.findFirst.mockResolvedValue(null);

    const result = await service.handleBictorysWebhook(
      webhookPayload,
      'secret',
    );

    expect(result).toEqual({ received: true, confirmed: false });
    expect(mockPrismaService.payment.updateMany).not.toHaveBeenCalled();
  });

  it('n’envoie ni notification ni email si le paiement était déjà confirmé', async () => {
    mockPrismaService.payment.findUnique.mockResolvedValue({
      ...payment,
      status: PaymentStatus.PAID,
    });

    const result = await service.handleBictorysWebhook(
      webhookPayload,
      'secret',
    );

    expect(result.confirmed).toBe(true);
    expect(mockPrismaService.payment.updateMany).not.toHaveBeenCalled();
    expect(
      mockNotificationsService.notifyPaymentReceived,
    ).not.toHaveBeenCalled();
    expect(mockTrackingService.trackPurchase).not.toHaveBeenCalled();
    expect(mockMailService.sendPaymentConfirmation).not.toHaveBeenCalled();
  });

  it('confirme sur la seule foi de la transaction serveur si la notification n’a pas de montant', async () => {
    const payloadWithoutAmount = {
      id: webhookPayload.id,
      status: webhookPayload.status,
      currency: webhookPayload.currency,
      paymentReference: webhookPayload.paymentReference,
      merchantReference: webhookPayload.merchantReference,
    };

    const result = await service.handleBictorysWebhook(
      payloadWithoutAmount,
      'secret',
    );

    expect(result.confirmed).toBe(true);
    expect(mockPrismaService.payment.updateMany).toHaveBeenCalled();
  });

  it('refuse de confirmer si aucun montant n’est connu', async () => {
    const payloadWithoutAmount = {
      id: webhookPayload.id,
      status: webhookPayload.status,
      currency: webhookPayload.currency,
      paymentReference: webhookPayload.paymentReference,
      merchantReference: webhookPayload.merchantReference,
    };
    mockBictorysService.getTransaction.mockResolvedValue({
      id: 'tx_1',
      status: 'succeeded',
      amount: Number.NaN,
      currency: 'XOF',
      raw: {},
    });

    const result = await service.handleBictorysWebhook(
      payloadWithoutAmount,
      'secret',
    );

    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain('Montant');
    expect(mockPrismaService.payment.updateMany).not.toHaveBeenCalled();
  });

  it('efface le motif de mise en attente une fois le paiement confirmé', async () => {
    mockPrismaService.payment.findUnique.mockResolvedValue({
      ...payment,
      metadata: {
        ...payment.metadata,
        holdReason: 'Montant payé inférieur au total',
        heldAt: '2026-01-01T00:00:00.000Z',
      },
    });

    await service.handleBictorysWebhook(webhookPayload, 'secret');

    const updateManyArgs = lastCallArgs(mockPrismaService.payment.updateMany);
    const data = updateManyArgs.data as {
      metadata: Record<string, unknown>;
    };
    expect(data.metadata.holdReason).toBeUndefined();
    expect(data.metadata.heldAt).toBeUndefined();
    expect(data.metadata.bictorysVerification).toBe('server');
  });

  describe('clé API publique (lecture des transactions refusée)', () => {
    const readForbiddenError = new BictorysApiError(
      403,
      'E403-1: Access right not sufficient',
      'Bictorys a refusé la requête (403) : E403-1: Access right not sufficient',
    );

    beforeEach(() => {
      mockBictorysService.getTransaction.mockRejectedValue(readForbiddenError);
      mockBictorysService.isTransactionReadForbidden.mockImplementation(
        (error: unknown) => error === readForbiddenError,
      );
    });

    it('confirme sur la notification authentifiée et trace la source', async () => {
      const result = await service.handleBictorysWebhook(
        webhookPayload,
        'secret',
      );

      expect(result.confirmed).toBe(true);
      expect(mockPrismaService.payment.updateMany).toHaveBeenCalled();

      const updateManyArgs = lastCallArgs(mockPrismaService.payment.updateMany);
      const data = updateManyArgs.data as {
        metadata: Record<string, unknown>;
      };
      expect(data.metadata.bictorysVerification).toBe('webhook');
    });

    it('refuse de confirmer si la notification ne porte aucun montant', async () => {
      const result = await service.handleBictorysWebhook(
        {
          id: webhookPayload.id,
          status: webhookPayload.status,
          currency: webhookPayload.currency,
          paymentReference: webhookPayload.paymentReference,
          merchantReference: webhookPayload.merchantReference,
        },
        'secret',
      );

      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain('Montant');
      expect(mockPrismaService.payment.updateMany).not.toHaveBeenCalled();
    });

    it('refuse de confirmer si le montant de la notification est insuffisant', async () => {
      const result = await service.handleBictorysWebhook(
        { ...webhookPayload, amount: 1000 },
        'secret',
      );

      expect(result.confirmed).toBe(false);
      expect(result.reason).toContain('inférieur au total');
      expect(mockPrismaService.payment.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('vérification manuelle', () => {
    it('refuse la vérification d’une commande qui n’appartient pas à l’utilisateur', async () => {
      mockPrismaService.order.findUnique.mockResolvedValue({
        ...order,
        userId: 'user_1',
        payments: [payment],
      });

      await expect(
        service.verifyBictorysPayment('user_2', ORDER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('confirme la commande après vérification serveur de la transaction', async () => {
      mockPrismaService.order.findUnique.mockResolvedValue({
        ...order,
        userId: 'user_1',
        payments: [{ ...payment, transactionId: 'tx_1' }],
      });

      const result = await service.verifyBictorysPayment('user_1', ORDER_ID);

      expect(result.confirmed).toBe(true);
      expect(mockBictorysService.getTransaction).toHaveBeenCalledWith('tx_1');
      expect(mockPrismaService.payment.updateMany).toHaveBeenCalled();
    });
  });
});
