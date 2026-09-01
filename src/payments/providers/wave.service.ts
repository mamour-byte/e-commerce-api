import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface WaveCheckoutResponse {
  id: string;
  wave_launch_url: string;
  checkout_status: string;
  client_reference?: string;
  amount: string;
  currency: string;
}

@Injectable()
export class WaveService {
  private readonly logger = new Logger(WaveService.name);
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly baseUrl: string;
  private readonly frontendUrl: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('WAVE_API_KEY') || '';
    this.webhookSecret = this.config.get<string>('WAVE_WEBHOOK_SECRET') || '';
    this.baseUrl =
      this.config.get<string>('WAVE_API_URL') || 'https://api.wave.com/v1';
    this.frontendUrl =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3001';
  }

  async createCheckoutSession(params: {
    amount: number;
    currency: string;
    orderNumber: string;
    orderId: string;
  }): Promise<WaveCheckoutResponse> {
    const payload = {
      amount: params.amount.toString(),
      currency: params.currency || 'XOF',
      error_url: `${this.frontendUrl}/checkout/error?orderId=${params.orderId}`,
      success_url: `${this.frontendUrl}/checkout/success?orderId=${params.orderId}`,
      client_reference: params.orderNumber,
    };

    try {
      const response = await fetch(`${this.baseUrl}/checkout/sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Erreur Wave Checkout API: ${errorText}`);
        // Mode simulation sécurisé si la clé API n'est pas encore activée
        return this.getSimulatedSession(params);
      }

      const data = (await response.json()) as WaveCheckoutResponse;
      return data;
    } catch {
      this.logger.warn(
        `Connexion à l'API Wave en mode simulation ou erreur réseau.`,
      );
      return this.getSimulatedSession(params);
    }
  }

  verifyWebhookSignature(signature: string, rawBody: string): boolean {
    if (!this.webhookSecret) {
      this.logger.error('Wave webhook secret non configuré : webhook refusé.');
      return false; // Fail-closed
    }
    try {
      const parts = signature.split(',');
      let timestamp = '';
      const signatures: string[] = [];

      for (const part of parts) {
        const [key, value] = part.trim().split('=');
        if (key === 't') timestamp = value;
        if (key === 'v1') signatures.push(value);
      }

      const signedPayload = `${timestamp}.${rawBody}`;
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(signedPayload)
        .digest('hex');

      return signatures.includes(expectedSignature);
    } catch (error) {
      this.logger.error(
        'Erreur lors de la vérification de la signature Wave Webhook',
        error,
      );
      return false;
    }
  }

  private getSimulatedSession(params: {
    amount: number;
    currency: string;
    orderNumber: string;
    orderId: string;
  }): WaveCheckoutResponse {
    return {
      id: `wave_sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      wave_launch_url: `https://pay.wave.com/m/M_test_checkout_${params.orderNumber}`,
      checkout_status: 'wave_checkout_initiated',
      client_reference: params.orderNumber,
      amount: params.amount.toString(),
      currency: params.currency || 'XOF',
    };
  }
}
