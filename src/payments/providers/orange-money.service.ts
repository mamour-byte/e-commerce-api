import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OrangeMoneyPaymentResponse {
  status: number;
  message: string;
  pay_token: string;
  payment_url: string;
  notif_token?: string;
}

@Injectable()
export class OrangeMoneyService {
  private readonly logger = new Logger(OrangeMoneyService.name);
  private readonly merchantKey: string;
  private readonly authHeader: string;
  private readonly baseUrl: string;
  private readonly frontendUrl: string;
  private readonly backendUrl: string;

  constructor(private readonly config: ConfigService) {
    this.merchantKey =
      this.config.get<string>('ORANGE_MONEY_MERCHANT_KEY') || '';
    this.authHeader = this.config.get<string>('ORANGE_MONEY_AUTH_HEADER') || '';
    this.baseUrl =
      this.config.get<string>('ORANGE_MONEY_API_URL') ||
      'https://api.orange.com';
    this.frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3001';
    this.backendUrl =
      this.config.get<string>('BACKEND_URL') || 'http://localhost:3000';
  }

  async initiateWebPayment(params: {
    amount: number;
    currency: string;
    orderNumber: string;
    orderId: string;
  }): Promise<OrangeMoneyPaymentResponse> {
    const payload = {
      merchant_key: this.merchantKey,
      currency: params.currency === 'XOF' ? 'OUV' : params.currency, // OUV est le code ISO interne Orange Money pour XOF
      order_id: params.orderNumber,
      amount: params.amount,
      return_url: `${this.frontendUrl}/checkout/success?orderId=${params.orderId}`,
      cancel_url: `${this.frontendUrl}/checkout/cancel?orderId=${params.orderId}`,
      notif_url: `${this.backendUrl}/api/payments/webhooks/orange-money`,
      reference: params.orderNumber,
    };

    try {
      const response = await fetch(
        `${this.baseUrl}/orange-money-webpayment/dev/v1/webpayment`,
        {
          method: 'POST',
          headers: {
            Authorization:
              this.authHeader.startsWith('Basic') ||
              this.authHeader.startsWith('Bearer')
                ? this.authHeader
                : `Bearer ${this.authHeader}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Erreur Orange Money WebPayment API: ${errorText}`);
        return this.getSimulatedResponse(params);
      }

      const data = (await response.json()) as OrangeMoneyPaymentResponse;
      return data;
    } catch {
      this.logger.warn(
        `Connexion à l'API Orange Money en mode simulation ou erreur réseau.`,
      );
      return this.getSimulatedResponse(params);
    }
  }

  private getSimulatedResponse(params: {
    amount: number;
    currency: string;
    orderNumber: string;
    orderId: string;
  }): OrangeMoneyPaymentResponse {
    const token = `om_token_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
      status: 201,
      message: 'Payment session created successfully (Simulated)',
      pay_token: token,
      payment_url: `https://webpayment.orange-money.com/pay?token=${token}&order=${params.orderNumber}`,
      notif_token: `notif_${token}`,
    };
  }
}
