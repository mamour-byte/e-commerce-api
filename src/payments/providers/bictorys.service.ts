import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  buildProviderRedirectUrl,
  normalizeBaseUrl,
} from '../checkout-redirect';

/**
 * Article d'une commande transmis à Bictorys (affiché sur la page de paiement).
 */
export interface BictorysOrderDetail {
  name: string;
  price: number;
  quantity: number;
  reference?: string;
}

export interface BictorysCustomer {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface BictorysCheckoutSession {
  /** Identifiant de l'objet "charge" créé par Bictorys. */
  chargeId: string;
  /** Jeton d'opération (Checkout) renvoyé par Bictorys. */
  opToken: string | null;
  /** URL de la page de paiement hébergée par Bictorys. */
  checkoutUrl: string;
  /** Identifiant de transaction (absent en mode Checkout : créé après paiement). */
  transactionId: string | null;
  /** Type d'objet renvoyé par l'API ("CheckoutLinkObject"). */
  type: string | null;
}

export interface BictorysTransaction {
  id: string;
  status: string;
  amount: number;
  currency: string;
  paymentReference: string | null;
  merchantReference: string | null;
  pspName: string | null;
  raw: Record<string, unknown>;
}

export interface BictorysWebhookPayload {
  id?: string;
  status?: string;
  amount?: number | string;
  currency?: string;
  paymentReference?: string;
  merchantReference?: string;
  pspName?: string;
  type?: string;
  [key: string]: unknown;
}

/** Réponse « CheckoutLinkObject » de l'API de création de charge. */
interface BictorysChargeResponse {
  link?: string;
  redirectUrl?: string;
  url?: string;
  chargeId?: string;
  id?: string;
  opToken?: string;
  op_token?: string;
  transactionId?: string;
  type?: string;
}

/** Réponse de l'API de consultation d'une transaction. */
interface BictorysTransactionResponse {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  paymentReference?: string | null;
  merchantReference?: string | null;
  pspName?: string | null;
  [key: string]: unknown;
}

/**
 * Erreur renvoyée par l'API Bictorys : on conserve le code HTTP et le
 * détail métier pour pouvoir distinguer, par exemple, une clé publique
 * (droit de lecture insuffisant) d'une panne réseau.
 */
export class BictorysApiError extends ServiceUnavailableException {
  constructor(
    readonly httpStatus: number,
    readonly details: string,
    message: string,
  ) {
    super(message);
    this.name = 'BictorysApiError';
  }
}

const SUCCESS_STATUSES = ['succeeded', 'authorized'];
const FAILED_STATUSES = [
  'failed',
  'cancelled',
  'canceled',
  'reversed',
  'expired',
];

@Injectable()
export class BictorysService {
  private readonly logger = new Logger(BictorysService.name);
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly baseUrl: string;
  /** URL publique de l'API : c'est elle qui est communiquée à Bictorys. */
  private readonly apiPublicUrl: string;
  private readonly country: string;
  private readonly locale: string;
  /** Restriction facultative de l'onglet affiché sur la page Bictorys. */
  private readonly paymentCategory: string | null;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('BICTORYS_API_KEY') || '';
    this.webhookSecret =
      this.config.get<string>('BICTORYS_WEBHOOK_SECRET') || '';
    this.baseUrl = (
      this.config.get<string>('BICTORYS_API_URL') ||
      'https://api.test.bictorys.com/pay/v1'
    ).replace(/\/$/, '');
    this.apiPublicUrl = normalizeBaseUrl(
      this.config.get<string>('API_PUBLIC_URL') ||
        this.config.get<string>('BACKEND_URL') ||
        this.config.get<string>('FRONTEND_URL') ||
        'http://localhost:3000',
    );
    this.country = this.config.get<string>('BICTORYS_COUNTRY') || 'SN';
    this.locale = this.config.get<string>('BICTORYS_LOCALE') || 'fr-FR';
    this.paymentCategory =
      this.config.get<string>('BICTORYS_PAYMENT_CATEGORY') || null;
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CRÉATION DE LA SESSION CHECKOUT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Crée une session de paiement sur la page hébergée par Bictorys.
   * L'API est appelée SANS le paramètre `payment_type` : le client choisit
   * lui-même son moyen de paiement (Wave, Orange Money, carte...).
   */
  async createCheckoutSession(params: {
    amount: number;
    currency: string;
    orderNumber: string;
    orderId: string;
    customer?: BictorysCustomer;
    orderDetails?: BictorysOrderDetail[];
  }): Promise<BictorysCheckoutSession> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Bictorys n’est pas configuré (BICTORYS_API_KEY manquant).',
      );
    }

    const successRedirectUrl = this.buildRedirectUrl(
      'success',
      params.orderId,
      params.orderNumber,
    );
    const errorRedirectUrl = this.buildRedirectUrl(
      'failed',
      params.orderId,
      params.orderNumber,
    );

    // Le sandbox de Bictorys filtre les URLs pointant vers une adresse locale
    // (protection anti-SSRF) : la requête est alors refusée en 403.
    if (
      isLocalHostname(successRedirectUrl) ||
      isLocalHostname(errorRedirectUrl)
    ) {
      this.logger.warn(
        `API_PUBLIC_URL pointe vers une adresse locale (${this.apiPublicUrl}) : le sandbox Bictorys va refuser la création de la session (403). Utilisez une URL publique (tunnel HTTPS) pour tester.`,
      );
    }

    const payload = {
      amount: Math.round(params.amount),
      currency: params.currency || 'XOF',
      // Référence affichée sur la page de paiement : sert à retrouver la commande.
      paymentReference: this.sanitizeReference(params.orderNumber),
      // Référence interne : clé de rapprochement la plus fiable avec la commande.
      merchantReference: params.orderId,
      country: this.country,
      successRedirectUrl,
      errorRedirectUrl,
      orderDetails: (params.orderDetails || []).map((item) => ({
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        ...(item.reference ? { reference: item.reference } : {}),
      })),
      customerObject: this.buildCustomerObject(params.customer),
      allowUpdateCustomer: false,
    };

    const data = await this.request<BictorysChargeResponse>(
      'POST',
      '/charges',
      {
        body: payload,
      },
    );

    const checkoutUrl: string | undefined =
      data?.link ?? data?.redirectUrl ?? data?.url;
    const chargeId: string | undefined = data?.chargeId ?? data?.id;

    if (!checkoutUrl) {
      this.logger.error(
        `Réponse Bictorys inattendue (pas d'URL de redirection) : ${JSON.stringify(data)}`,
      );
      throw new ServiceUnavailableException(
        'Bictorys n’a pas retourné de lien de paiement.',
      );
    }

    return {
      chargeId: chargeId ?? this.extractChargeId(checkoutUrl),
      opToken: data?.opToken ?? data?.op_token ?? null,
      checkoutUrl: this.applyPaymentCategory(checkoutUrl),
      transactionId: data?.transactionId ?? null,
      type: data?.type ?? null,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VÉRIFICATION SERVEUR D'UNE TRANSACTION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Source de vérité : le statut de la transaction Interrogé DIRECTEMENT
   * chez Bictorys. La redirection navigateur n’est jamais une preuve.
   */
  async getTransaction(transactionId: string): Promise<BictorysTransaction> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Bictorys n’est pas configuré (BICTORYS_API_KEY manquant).',
      );
    }

    const data = await this.request<BictorysTransactionResponse>(
      'GET',
      `/transactions/${encodeURIComponent(transactionId)}`,
    );

    return {
      id: String(data?.id ?? transactionId),
      status: String(data?.status ?? '').toLowerCase(),
      amount: Number(data?.amount ?? 0),
      currency: String(data?.currency ?? '').toUpperCase(),
      paymentReference: data?.paymentReference ?? null,
      merchantReference: data?.merchantReference ?? null,
      pspName: data?.pspName ?? null,
      raw: data,
    };
  }

  /**
   * Recherche une transaction par paymentReference (n° de commande).
   * Utile quand le transactionId n'est pas encore connu (webhook non reçu).
   */
  async findTransactionByReference(
    paymentReference: string,
  ): Promise<BictorysTransaction | null> {
    if (!this.isConfigured) return null;
    try {
      const data = await this.request<{ data?: BictorysTransactionResponse[]; items?: BictorysTransactionResponse[] } | BictorysTransactionResponse>(
        'GET',
        `/transactions?paymentReference=${encodeURIComponent(paymentReference)}&limit=1`,
      );
      // API may return a list or a single object
      const list =
        (data as any)?.data ??
        (data as any)?.items ??
        (Array.isArray(data) ? data : null);
      const item: BictorysTransactionResponse | undefined = list
        ? list[0]
        : (data as BictorysTransactionResponse);
      if (!item?.id) return null;
      return {
        id: String(item.id),
        status: String(item.status ?? '').toLowerCase(),
        amount: Number(item.amount ?? 0),
        currency: String(item.currency ?? '').toUpperCase(),
        paymentReference: item.paymentReference ?? null,
        merchantReference: item.merchantReference ?? null,
        pspName: item.pspName ?? null,
        raw: item as Record<string, unknown>,
      };
    } catch (error) {
      this.logger.error(
        `findTransactionByReference(${paymentReference}) a échoué : ${(error as Error).message}`,
      );
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WEBHOOK
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Vérifie le header `X-Secret-Key` contre la clé secrète du webhook
   * configurée dans le dashboard Bictorys (fail-closed).
   */
  verifyWebhookSecret(receivedSecret: string | undefined): boolean {
    if (!this.webhookSecret) {
      this.logger.error(
        'Webhook Bictorys refusé : BICTORYS_WEBHOOK_SECRET non configuré.',
      );
      return false;
    }
    if (!receivedSecret) {
      return false;
    }
    return secureCompare(receivedSecret, this.webhookSecret);
  }

  isSuccessfulStatus(status: string | undefined | null): boolean {
    return SUCCESS_STATUSES.includes(String(status ?? '').toLowerCase());
  }

  isFailedStatus(status: string | undefined | null): boolean {
    return FAILED_STATUSES.includes(String(status ?? '').toLowerCase());
  }

  /**
   * Vrai si l'API Bictorys a refusé la lecture d'une transaction parce que
   * la clé API utilisée n'a pas le droit de lecture (clé publique).
   * Dans ce cas la source de vérité serveur n'est pas interrogeable et l'on
   * doit s'appuyer sur la notification authentifiée par la clé secrète.
   */
  isTransactionReadForbidden(error: unknown): boolean {
    if (!(error instanceof BictorysApiError)) {
      return false;
    }
    if (error.httpStatus !== 403 && error.httpStatus !== 401) {
      return false;
    }
    return /E403-1|access right|insufficient|forbidden/i.test(error.details);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS PRIVÉS
  // ─────────────────────────────────────────────────────────────────────────

  private buildCustomerObject(
    customer?: BictorysCustomer,
  ): Record<string, unknown> | undefined {
    if (!customer) {
      return undefined;
    }
    return {
      name: customer.name ?? undefined,
      email: customer.email ?? undefined,
      phone: customer.phone ?? undefined,
      address: customer.address ?? undefined,
      city: customer.city ?? undefined,
      country: customer.country ?? this.country,
      locale: this.locale,
    };
  }

  private buildRedirectUrl(
    page: 'success' | 'failed',
    orderId: string,
    orderNumber: string,
  ): string {
    return buildProviderRedirectUrl(this.apiPublicUrl, page, {
      orderId,
      orderNumber,
    });
  }

  /** Restriction facultative de l'onglet (card | mobile_money). */
  private applyPaymentCategory(url: string): string {
    if (!this.paymentCategory) {
      return url;
    }
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}payment_category=${encodeURIComponent(this.paymentCategory)}`;
  }

  /** Bictorys n'accepte pas de caractères exotiques dans les références. */
  private sanitizeReference(reference: string): string {
    return reference.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  }

  private extractChargeId(url: string): string {
    const match = url.match(/\/charges\/([A-Za-z0-9-]+)/);
    return match ? match[1] : '';
  }

  private async request<T = unknown>(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Api-Key': this.apiKey,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const data = text ? safeJsonParse(text) : null;

      if (!response.ok) {
        const details = extractDetails(data);
        const hint =
          response.status === 403 && !details
            ? ' Si l’URL de redirection pointe vers une adresse locale (localhost, 127.0.0.1), le pare-feu du sandbox la bloque : utilisez une URL publique (tunnel HTTPS).'
            : '';
        const message = details
          ? `Bictorys a refusé la requête (${response.status}) : ${details}`
          : `Bictorys a refusé la requête (${response.status}).${hint}`;
        this.logger.error(
          `Erreur API Bictorys ${method} ${path} (${response.status}) : ${details || message}`,
        );
        throw new BictorysApiError(response.status, details, message);
      }

      return data as T;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      this.logger.error(
        `Échec de l'appel Bictorys ${method} ${path} : ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Bictorys est injoignable pour le moment.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Extrait le champ `details` des erreurs renvoyées par l'API Bictorys. */
function extractDetails(data: unknown): string {
  if (data && typeof data === 'object' && 'details' in data) {
    const details = (data as { details?: unknown }).details;
    if (typeof details === 'string') {
      return details;
    }
    if (typeof details === 'number' || typeof details === 'boolean') {
      return String(details);
    }
    if (details && typeof details === 'object') {
      return JSON.stringify(details);
    }
  }
  return '';
}

/**
 * Détecte une URL pointant vers laddresses locales (localhost, 127.0.0.1,
 * 0.0.0.0, .local). Le sandbox Bictorys refuse ces URLs (403).
 */
function isLocalHostname(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    );
  } catch {
    return false;
  }
}

function secureCompare(a: string, b: string): boolean {
  const aHash = createHash('sha256').update(a).digest();
  const bHash = createHash('sha256').update(b).digest();
  return timingSafeEqual(aHash, bHash);
}
