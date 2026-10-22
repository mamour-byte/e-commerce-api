import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { BictorysApiError, BictorysService } from './bictorys.service';

describe('BictorysService', () => {
  const WEBHOOK_SECRET = 'whsec_test_123';

  function buildService(env: Record<string, string | undefined>) {
    const config = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
    return new BictorysService(config);
  }

  describe('verifyWebhookSecret', () => {
    it('refuse toute notification si le secret webhook n’est pas configuré', () => {
      const service = buildService({ BICTORYS_API_KEY: 'key' });

      expect(service.verifyWebhookSecret(WEBHOOK_SECRET)).toBe(false);
    });

    it('refuse une notification sans header', () => {
      const service = buildService({
        BICTORYS_API_KEY: 'key',
        BICTORYS_WEBHOOK_SECRET: WEBHOOK_SECRET,
      });

      expect(service.verifyWebhookSecret(undefined)).toBe(false);
      expect(service.verifyWebhookSecret('')).toBe(false);
    });

    it('refuse un secret incorrect', () => {
      const service = buildService({
        BICTORYS_API_KEY: 'key',
        BICTORYS_WEBHOOK_SECRET: WEBHOOK_SECRET,
      });

      expect(service.verifyWebhookSecret('mauvais-secret')).toBe(false);
    });

    it('accepte le bon secret', () => {
      const service = buildService({
        BICTORYS_API_KEY: 'key',
        BICTORYS_WEBHOOK_SECRET: WEBHOOK_SECRET,
      });

      expect(service.verifyWebhookSecret(WEBHOOK_SECRET)).toBe(true);
    });
  });

  describe('statuts', () => {
    const service = buildService({ BICTORYS_API_KEY: 'key' });

    it('reconnait les statuts de succès', () => {
      expect(service.isSuccessfulStatus('succeeded')).toBe(true);
      expect(service.isSuccessfulStatus('SUCCEEDED')).toBe(true);
      expect(service.isSuccessfulStatus('authorized')).toBe(true);
      expect(service.isSuccessfulStatus('pending')).toBe(false);
      expect(service.isSuccessfulStatus(undefined)).toBe(false);
    });

    it('reconnait les statuts d’échec', () => {
      expect(service.isFailedStatus('failed')).toBe(true);
      expect(service.isFailedStatus('cancelled')).toBe(true);
      expect(service.isFailedStatus('canceled')).toBe(true);
      expect(service.isFailedStatus('reversed')).toBe(true);
      expect(service.isFailedStatus('expired')).toBe(true);
      expect(service.isFailedStatus('succeeded')).toBe(false);
    });
  });

  describe('isTransactionReadForbidden', () => {
    const service = buildService({ BICTORYS_API_KEY: 'key' });

    it('détecte le refus de lecture d’une clé publique', () => {
      expect(
        service.isTransactionReadForbidden(
          new BictorysApiError(
            403,
            'E403-1: Access right not sufficient',
            'refus',
          ),
        ),
      ).toBe(true);
    });

    it('ne confond pas une panne réseau avec un refus de droit', () => {
      expect(
        service.isTransactionReadForbidden(
          new ServiceUnavailableException('Bictorys est injoignable.'),
        ),
      ).toBe(false);
      expect(
        service.isTransactionReadForbidden(
          new BictorysApiError(500, 'Internal error', 'panne'),
        ),
      ).toBe(false);
      expect(service.isTransactionReadForbidden(new Error('x'))).toBe(false);
    });
  });

  describe('createCheckoutSession', () => {
    it('refuse de créer une session sans clé API (fail-closed)', async () => {
      const service = buildService({});

      await expect(
        service.createCheckoutSession({
          amount: 1000,
          currency: 'XOF',
          orderNumber: 'ORD-20260101-ABCDE',
          orderId: 'order_1',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('envoie les redirections et les références attendues', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 202,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              type: 'CheckoutLinkObject',
              link: 'https://pay.test.bictorys.com/payment/v1/checkout?charge_id=abc',
              chargeId: 'abc',
              opToken: 'token_1',
            }),
          ),
      });
      global.fetch = fetchMock;

      const service = buildService({
        BICTORYS_API_KEY: 'key',
        API_PUBLIC_URL: 'https://api.example.com',
      });

      const session = await service.createCheckoutSession({
        amount: 15000,
        currency: 'XOF',
        orderNumber: 'ORD-20260101-ABCDE',
        orderId: 'order_1',
      });

      expect(session.chargeId).toBe('abc');
      expect(session.checkoutUrl).toContain('charge_id=abc');

      const requestInit = (
        fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      )[1];
      const body = JSON.parse(requestInit.body as string) as {
        paymentReference: string;
        merchantReference: string;
        successRedirectUrl: string;
        errorRedirectUrl: string;
      };
      expect(body.paymentReference).toBe('ORD-20260101-ABCDE');
      expect(body.merchantReference).toBe('order_1');
      // L'URL de retour passe par l'API (URL publique obligatoire) et non
      // directement par le front.
      expect(body.successRedirectUrl).toBe(
        'https://api.example.com/api/payments/redirect/success?orderId=order_1&orderNumber=ORD-20260101-ABCDE',
      );
      expect(body.errorRedirectUrl).toContain('/api/payments/redirect/failed');
    });

    it('signale clairement le blocage des URLs locales (403 du pare-feu)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('<html><body>403 Forbidden</body></html>'),
      });

      const service = buildService({
        BICTORYS_API_KEY: 'key',
        API_PUBLIC_URL: 'http://localhost:3000',
      });

      await expect(
        service.createCheckoutSession({
          amount: 15000,
          currency: 'XOF',
          orderNumber: 'ORD-20260101-ABCDE',
          orderId: 'order_1',
        }),
      ).rejects.toThrow(/adresse locale/);
    });
  });
});
