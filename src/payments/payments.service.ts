import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  InventoryMovementType,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { OrangeMoneyService } from './providers/orange-money.service';
import { WaveService } from './providers/wave.service';
import {
  BictorysService,
  type BictorysTransaction,
  type BictorysWebhookPayload,
} from './providers/bictorys.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TrackingService } from '../tracking/tracking.service';
import {
  buildBrowserRedirectUrl,
  isCheckoutRedirectKind,
  normalizeBaseUrl,
} from './checkout-redirect';

function secureCompare(a: string, b: string): boolean {
  const aHash = createHash('sha256').update(a).digest();
  const bHash = createHash('sha256').update(b).digest();
  return timingSafeEqual(aHash, bHash);
}

/** Tolérance de comparaison des montants (2 décimales). */
const AMOUNT_TOLERANCE = 0.01;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  /** URL finale atteinte par le navigateur après paiement (front). */
  private readonly browserFrontendUrl: string;
  /** Fenêtre pendant laquelle le client peut payer. */
  private readonly paymentExpirationMs: number;
  /** Délai de sécurité avant de déclarer un paiement abandonné. */
  private readonly paymentExpiryGraceMs: number;
  /** Intervalle entre deux vérifications serveur d'un paiement non définitif. */
  private readonly reconciliationRetryMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly waveService: WaveService,
    private readonly orangeMoneyService: OrangeMoneyService,
    private readonly bictorysService: BictorysService,
    private readonly mailService: MailService,
    private readonly notificationsService: NotificationsService,
    private readonly trackingService: TrackingService,
    private readonly config: ConfigService,
  ) {
    this.browserFrontendUrl = normalizeBaseUrl(
      this.config.get<string>('FRONTEND_BROWSER_URL') ||
        this.config.get<string>('FRONTEND_URL') ||
        'http://localhost:5173',
    );
    this.paymentExpirationMs =
      readPositiveMinutes(this.config, 'PAYMENT_EXPIRATION_MINUTES', 15) *
      60_000;
    this.paymentExpiryGraceMs =
      readPositiveMinutes(this.config, 'PAYMENT_EXPIRY_GRACE_MINUTES', 10) *
      60_000;
    this.reconciliationRetryMs =
      readPositiveMinutes(
        this.config,
        'PAYMENT_RECONCILIATION_RETRY_MINUTES',
        15,
      ) * 60_000;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INITIALISATION D'UN PAIEMENT
  // ─────────────────────────────────────────────────────────────────────────

  async initiatePayment(userId: string | null, dto: InitiatePaymentDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
    });

    if (!order) {
      throw new NotFoundException('Commande introuvable.');
    }

    // Vérification d'appartenance : une commande rattachée à un compte
    // ne peut être payée que par son propriétaire.
    if (order.userId) {
      if (!userId || order.userId !== userId) {
        throw new ForbiddenException('Cette commande ne vous appartient pas.');
      }
    } else if (userId) {
      throw new ForbiddenException('Cette commande ne vous appartient pas.');
    }

    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException('Cette commande a déjà été payée.');
    }

    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.REFUNDED
    ) {
      throw new BadRequestException(
        `Impossible d'initier un paiement pour une commande ${order.status.toLowerCase()}.`,
      );
    }

    const amount = Number(order.total);
    const currency = order.currency;
    const deadlines = this.buildPaymentDeadlines();

    switch (dto.provider) {
      case PaymentProvider.WAVE: {
        const waveSession = await this.waveService.createCheckoutSession({
          amount,
          currency,
          orderNumber: order.orderNumber,
          orderId: order.id,
        });

        const payment = await this.prisma.payment.create({
          data: {
            orderId: order.id,
            provider: PaymentProvider.WAVE,
            amount: order.total,
            currency,
            status: PaymentStatus.PENDING,
            expiresAt: deadlines.expiresAt,
            nextReconciliationAt: deadlines.nextReconciliationAt,
            transactionId: waveSession.id,
            providerReference:
              waveSession.client_reference || order.orderNumber,
            metadata: {
              wave_launch_url: waveSession.wave_launch_url,
              checkout_status: waveSession.checkout_status,
            },
          },
        });

        await this.prisma.order.update({
          where: { id: order.id },
          data: { paymentStatus: PaymentStatus.PROCESSING },
        });

        return {
          paymentId: payment.id,
          provider: PaymentProvider.WAVE,
          paymentUrl: waveSession.wave_launch_url,
          status: payment.status,
          amount,
          currency,
          expiresAt: payment.expiresAt,
        };
      }

      case PaymentProvider.ORANGE_MONEY: {
        const omResponse = await this.orangeMoneyService.initiateWebPayment({
          amount,
          currency,
          orderNumber: order.orderNumber,
          orderId: order.id,
        });

        const payment = await this.prisma.payment.create({
          data: {
            orderId: order.id,
            provider: PaymentProvider.ORANGE_MONEY,
            amount: order.total,
            currency,
            status: PaymentStatus.PENDING,
            expiresAt: deadlines.expiresAt,
            nextReconciliationAt: deadlines.nextReconciliationAt,
            transactionId: omResponse.pay_token,
            providerReference: omResponse.notif_token || order.orderNumber,
            metadata: {
              payment_url: omResponse.payment_url,
              pay_token: omResponse.pay_token,
            },
          },
        });

        await this.prisma.order.update({
          where: { id: order.id },
          data: { paymentStatus: PaymentStatus.PROCESSING },
        });

        return {
          paymentId: payment.id,
          provider: PaymentProvider.ORANGE_MONEY,
          paymentUrl: omResponse.payment_url,
          status: payment.status,
          amount,
          currency,
          expiresAt: payment.expiresAt,
        };
      }

      case PaymentProvider.BICTORYS: {
        const orderItems = await this.prisma.orderItem.findMany({
          where: { orderId: order.id },
          select: {
            productName: true,
            variantName: true,
            sku: true,
            quantity: true,
            unitPrice: true,
          },
        });

        const session = await this.bictorysService.createCheckoutSession({
          amount,
          currency,
          orderNumber: order.orderNumber,
          orderId: order.id,
          customer: {
            name:
              [order.shippingFirstName, order.shippingLastName]
                .filter(Boolean)
                .join(' ') || null,
            email: order.customerEmail,
            phone: order.customerPhone,
            address: order.shippingAddress,
            city: order.shippingCity,
            country: order.shippingCountry || 'SN',
          },
          orderDetails: orderItems.map((item) => ({
            name: item.variantName
              ? `${item.productName} — ${item.variantName}`
              : item.productName,
            price: Number(item.unitPrice),
            quantity: item.quantity,
            reference: item.sku ?? undefined,
          })),
        });

        const payment = await this.prisma.payment.create({
          data: {
            orderId: order.id,
            provider: PaymentProvider.BICTORYS,
            amount: order.total,
            currency,
            status: PaymentStatus.PENDING,
            expiresAt: deadlines.expiresAt,
            nextReconciliationAt: deadlines.nextReconciliationAt,
            // paymentReference envoyé à Bictorys : clé de rapprochement webhook.
            providerReference: order.orderNumber,
            metadata: {
              paymentReference: order.orderNumber,
              merchantReference: order.id,
              chargeId: session.chargeId,
              opToken: session.opToken,
              checkoutUrl: session.checkoutUrl,
            },
          },
        });

        await this.prisma.order.update({
          where: { id: order.id },
          data: { paymentStatus: PaymentStatus.PROCESSING },
        });

        return {
          paymentId: payment.id,
          provider: PaymentProvider.BICTORYS,
          paymentUrl: session.checkoutUrl,
          status: payment.status,
          amount,
          currency,
          expiresAt: payment.expiresAt,
        };
      }

      case PaymentProvider.CASH_ON_DELIVERY: {
        const payment = await this.prisma.payment.create({
          data: {
            orderId: order.id,
            provider: PaymentProvider.CASH_ON_DELIVERY,
            amount: order.total,
            currency,
            status: PaymentStatus.PENDING,
            metadata: {
              note: 'Paiement en espèces à la livraison',
              customerPhone: dto.customerPhoneNumber || order.customerPhone,
            },
          },
        });

        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            paymentStatus: PaymentStatus.PENDING,
            status: OrderStatus.CONFIRMED, // Commande confirmée pour préparation de livraison
          },
        });

        return {
          paymentId: payment.id,
          provider: PaymentProvider.CASH_ON_DELIVERY,
          paymentUrl: null,
          status: payment.status,
          amount,
          currency,
          expiresAt: null,
          message:
            'Commande enregistrée avec succès. Le paiement sera effectué en espèces à la livraison.',
        };
      }

      default:
        throw new BadRequestException(
          `Fournisseur de paiement "${dto.provider}" non pris en charge.`,
        );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WEBHOOK WAVE
  // ─────────────────────────────────────────────────────────────────────────

  async handleWaveWebhook(
    signature: string,
    rawBody: string,
    payload: Record<string, unknown>,
  ) {
    const isValid = this.waveService.verifyWebhookSignature(signature, rawBody);
    if (!isValid) {
      this.logger.error('Signature Wave Webhook invalide');
      throw new UnauthorizedException('Signature Webhook invalide.');
    }

    this.logger.log(`Webhook Wave reçu : ${JSON.stringify(payload)}`);

    const eventType = payload.type ?? payload.event;
    const data = (payload.data ?? payload) as Record<string, unknown>;
    const transactionId = data.id as string | undefined;
    const clientReference = data.client_reference as string | undefined;
    const canIdentifyPayment = Boolean(transactionId || clientReference);

    if (canIdentifyPayment && isProviderSuccessStatus(eventType)) {
      const payment = await this.prisma.payment.findFirst({
        where: {
          OR: [
            { transactionId },
            { providerReference: clientReference },
            { order: { orderNumber: clientReference } },
          ],
        },
        include: { order: true },
      });

      if (payment && payment.status !== PaymentStatus.PAID) {
        await this.confirmPayment(payment.id, payment.orderId, 'Wave Webhook');
      }

      return { received: true };
    }

    const failureKind = resolveFailureKind(
      eventType,
      data.checkout_status,
      data.status,
    );

    if (canIdentifyPayment && failureKind) {
      const payment = await this.prisma.payment.findFirst({
        where: {
          OR: [
            { transactionId },
            { providerReference: clientReference },
            { order: { orderNumber: clientReference } },
          ],
        },
        include: { order: true },
      });

      if (payment && payment.status !== PaymentStatus.PAID) {
        if (failureKind === 'expired') {
          await this.markPaymentExpired(
            payment.id,
            payment.orderId,
            `Wave : statut "${normalizeProviderStatus(data.checkout_status ?? data.status ?? eventType)}"`,
          );
        } else {
          await this.markPaymentFailed(
            payment.id,
            payment.orderId,
            `Wave : statut "${normalizeProviderStatus(data.checkout_status ?? data.status ?? eventType)}"`,
          );
        }
      }

      return { received: true };
    }

    return { received: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WEBHOOK ORANGE MONEY
  // ─────────────────────────────────────────────────────────────────────────

  async handleOrangeMoneyWebhook(
    payload: Record<string, unknown>,
    signature?: string,
  ) {
    // Fail-closed : tant que les webhooks OM ne sont pas configurés
    // (ORANGE_MONEY_WEBHOOK_SECRET absent), aucun webhook n'est accepté.
    const secret = this.config.get<string>('ORANGE_MONEY_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error('Webhook Orange Money refusé : secret non configuré.');
      throw new UnauthorizedException('Webhook non configuré.');
    }
    if (!signature || !secureCompare(signature, secret)) {
      this.logger.error('Webhook Orange Money refusé : signature invalide.');
      throw new UnauthorizedException('Signature Webhook invalide.');
    }

    this.logger.log(`Webhook Orange Money reçu : ${JSON.stringify(payload)}`);

    const status = payload.status ?? payload.status_payment;
    const orderIdRef = (payload.order_id ?? payload.reference) as
      string | undefined;
    const payToken = (payload.pay_token ??
      payload.notif_token ??
      payload.txnid) as string | undefined;
    const canIdentifyPayment = Boolean(payToken || orderIdRef);

    const payment = canIdentifyPayment
      ? await this.prisma.payment.findFirst({
          where: {
            OR: [
              { transactionId: payToken },
              { providerReference: payToken },
              { order: { orderNumber: orderIdRef } },
            ],
          },
          include: { order: true },
        })
      : null;

    if (isProviderSuccessStatus(status)) {
      if (payment && payment.status !== PaymentStatus.PAID) {
        await this.confirmPayment(
          payment.id,
          payment.orderId,
          'Orange Money Webhook',
        );
      }

      return { status: 'OK' };
    }

    const failureKind = resolveFailureKind(status);

    if (failureKind && payment && payment.status !== PaymentStatus.PAID) {
      if (failureKind === 'expired') {
        await this.markPaymentExpired(
          payment.id,
          payment.orderId,
          `Orange Money : statut "${normalizeProviderStatus(status)}"`,
        );
      } else {
        await this.markPaymentFailed(
          payment.id,
          payment.orderId,
          `Orange Money : statut "${normalizeProviderStatus(status)}"`,
        );
      }
    }

    return { status: 'OK' };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WEBHOOK BICTORYS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Notification serveur à serveur de Bictorys.
   *
   * Règle de sécurité : la redirection du navigateur vers la page de succès
   * n'est PAS une preuve de paiement. Seul un statut de transaction vérifié
   * côté serveur (statut + montant + référence) autorise le marquage "payée".
   */
  async handleBictorysWebhook(
    payload: BictorysWebhookPayload,
    secret?: string,
  ) {
    // Fail-closed : sans clé secrète configurée (ou invalide), rien n'est accepté.
    if (!this.bictorysService.verifyWebhookSecret(secret)) {
      this.logger.error('Webhook Bictorys refusé : clé secrète invalide.');
      throw new UnauthorizedException('Signature Webhook invalide.');
    }

    this.logger.log(`Webhook Bictorys reçu : ${JSON.stringify(payload)}`);

    const transactionId = payload.id ? String(payload.id) : null;
    const status = String(payload.status ?? '').toLowerCase();
    const paymentReference = payload.paymentReference
      ? String(payload.paymentReference)
      : null;
    const merchantReference = payload.merchantReference
      ? String(payload.merchantReference)
      : null;

    if (!transactionId && !paymentReference && !merchantReference) {
      throw new BadRequestException('Payload de webhook Bictorys incomplet.');
    }

    const payment = await this.findBictorysPayment({
      transactionId,
      paymentReference,
      merchantReference,
    });

    if (!payment) {
      this.logger.warn(
        `Webhook Bictorys : aucun paiement trouvé (ref=${paymentReference}, tx=${transactionId})`,
      );
      return { received: true, confirmed: false };
    }

    // On mémorise les données de la notification : elles permettent la
    // vérification serveur (source de vérité) et la traçabilité.
    await this.persistBictorysTransaction(payment, {
      transactionId,
      pspName: payload.pspName ? String(payload.pspName) : null,
      amount:
        payload.amount !== undefined && payload.amount !== null
          ? Number(payload.amount)
          : null,
      currency: payload.currency ? String(payload.currency) : null,
      status: status || null,
    });

    if (this.bictorysService.isExpiredStatus(status)) {
      await this.markPaymentExpired(
        payment.id,
        payment.orderId,
        `Bictorys : statut "${status}"`,
      );
      return { received: true, confirmed: false, status };
    }

    if (this.bictorysService.isFailedStatus(status)) {
      await this.markPaymentFailed(
        payment.id,
        payment.orderId,
        `Bictorys : statut "${status}"`,
      );
      return { received: true, confirmed: false, status };
    }

    if (!this.bictorysService.isSuccessfulStatus(status)) {
      // pending / processing : le paiement est en cours, on ne confirme rien.
      this.logger.log(
        `Webhook Bictorys : transaction ${transactionId} au statut "${status}" (non confirmée).`,
      );
      return { received: true, confirmed: false, status };
    }

    const check = await this.verifyBictorysTransaction(payment, {
      transactionId,
      webhookAmount:
        payload.amount !== undefined && payload.amount !== null
          ? Number(payload.amount)
          : null,
      webhookCurrency: payload.currency ? String(payload.currency) : null,
      webhookStatus: status,
    });

    if (!check.ok) {
      this.logger.error(
        `Webhook Bictorys : confirmation refusée pour la commande ${payment.orderId} — ${check.reason}`,
      );
      await this.holdBictorysPayment(
        payment.id,
        check.reason ?? 'Vérification échouée',
      );
      return { received: true, confirmed: false, reason: check.reason };
    }

    await this.confirmPayment(payment.id, payment.orderId, 'Bictorys Webhook', {
      bictorysTransactionId: transactionId,
      bictorysStatus: status,
      pspName: payload.pspName ? String(payload.pspName) : null,
      bictorysVerification: check.source ?? 'server',
    });

    return { received: true, confirmed: true };
  }

  /**
   * Vérification manuelle (bouton « Vérifier le paiement » côté client).
   * Utile quand le webhook n'a pas encore été reçu : la confirmation reste
   * conditionnée à une vérification serveur de la transaction.
   */
  async verifyBictorysPayment(userId: string | null, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: { include: { order: true } } },
    });

    if (!order) {
      throw new NotFoundException('Commande introuvable.');
    }

    if (order.userId) {
      if (!userId || order.userId !== userId) {
        throw new ForbiddenException('Cette commande ne vous appartient pas.');
      }
    } else if (userId) {
      throw new ForbiddenException('Cette commande ne vous appartient pas.');
    }

    const payment = order.payments.find(
      (p) => p.provider === PaymentProvider.BICTORYS,
    );

    if (!payment) {
      throw new NotFoundException(
        'Aucun paiement Bictorys pour cette commande.',
      );
    }

    if (payment.status === PaymentStatus.PAID) {
      return {
        confirmed: true,
        status: payment.status,
        orderStatus: order.status,
      };
    }

    const metadata = readMetadata(payment.metadata);
    const transactionId =
      payment.transactionId ??
      (metadata.bictorysTransactionId as string | null) ??
      null;

    // If transactionId is not yet known (webhook not received), try to find
    // the transaction by paymentReference (order number) directly from Bictorys
    const orderNumber =
      payment.order?.orderNumber ??
      (metadata.paymentReference as string | undefined) ??
      '';
    const resolvedTransactionId =
      transactionId ??
      (await this.bictorysService
        .findTransactionByReference(orderNumber)
        .then((tx) => {
          if (!tx) return null;
          // Security: ensure the transaction belongs to this order
          const refMatch =
            !tx.paymentReference || tx.paymentReference === orderNumber;
          const merchantMatch =
            !tx.merchantReference || tx.merchantReference === order.id;
          if (!refMatch || !merchantMatch) {
            this.logger.error(
              `findTransactionByReference: transaction ${tx.id} ne correspond pas à la commande ${order.id} (paymentReference=${tx.paymentReference}, merchantReference=${tx.merchantReference})`,
            );
            return null;
          }
          return tx.id;
        })
        .catch(() => null));

    if (!resolvedTransactionId) {
      return {
        confirmed: false,
        status: payment.status,
        orderStatus: order.status,
        reason:
          'Transaction Bictorys encore inconnue : le paiement est en cours de traitement.',
      };
    }

    const check = await this.verifyBictorysTransaction(
      { ...payment, order },
      {
        transactionId: resolvedTransactionId,
        webhookAmount: Number.isFinite(Number(metadata.bictorysWebhookAmount))
          ? Number(metadata.bictorysWebhookAmount)
          : null,
        webhookCurrency: metadata.bictorysWebhookCurrency
          ? String(metadata.bictorysWebhookCurrency)
          : null,
        webhookStatus: metadata.bictorysWebhookStatus
          ? String(metadata.bictorysWebhookStatus)
          : null,
      },
    );

    if (!check.ok) {
      return {
        confirmed: false,
        status: payment.status,
        orderStatus: order.status,
        reason: check.reason,
      };
    }

    await this.confirmPayment(
      payment.id,
      order.id,
      'Vérification manuelle Bictorys',
      {
        bictorysTransactionId: resolvedTransactionId,
        bictorysVerification: check.source ?? 'server',
      },
    );

    return {
      confirmed: true,
      status: PaymentStatus.PAID,
      orderStatus: OrderStatus.CONFIRMED,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CYCLE DE VIE : EXPIRATION ET RÉCONCILIATION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Traite les paiements dont la fenêtre de paiement est dépassée.
   *
   * Un paiement n'est jamais déclaré abandonné sur la seule absence de
   * webhook : le statut réel est d'abord vérifié chez Bictorys quand
   * l'intégration le permet. Un délai de grâce (configurable) couvre les
   * webhooks retardés. Un webhook tardif reste traité et peut encore
   * confirmer un paiement déjà expiré localement.
   */
  async expireAbandonedPayments(now = new Date()): Promise<{
    checked: number;
    paid: number;
    failed: number;
    expired: number;
    pending: number;
    errors: number;
  }> {
    const payments = await this.prisma.payment.findMany({
      where: {
        status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
        nextReconciliationAt: { lte: now },
        provider: {
          in: [
            PaymentProvider.BICTORYS,
            PaymentProvider.WAVE,
            PaymentProvider.ORANGE_MONEY,
          ],
        },
      },
      include: { order: true },
      orderBy: { nextReconciliationAt: 'asc' },
      take: 50,
    });

    const summary = {
      checked: payments.length,
      paid: 0,
      failed: 0,
      expired: 0,
      pending: 0,
      errors: 0,
    };

    for (const payment of payments) {
      try {
        const outcome = await this.reconcilePayment(payment, now);
        summary[outcome] += 1;
      } catch (error) {
        summary.errors += 1;
        this.logger.error(
          `Réconciliation du paiement ${payment.id} impossible : ${(error as Error).message}`,
        );

        try {
          await this.scheduleNextReconciliation(
            payment.id,
            new Date(now.getTime() + this.reconciliationRetryMs),
            {
              lastReconciliationAt: now.toISOString(),
              lastReconciliationError: (error as Error).message,
            },
          );
        } catch (scheduleError) {
          this.logger.error(
            `Replanification du paiement ${payment.id} impossible : ${(scheduleError as Error).message}`,
          );
        }
      }
    }

    return summary;
  }

  /**
   * Statut de paiement d'une commande pour la page de retour du paiement.
   * Sert au client pour afficher l'état RÉEL du paiement : la redirection
   * navigateur ne suffit pas, c'est la base de données qui fait foi.
   */
  async getCheckoutStatus(orderId: string, orderNumber?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        total: true,
        currency: true,
        paidAt: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Commande introuvable.');
    }

    // Double vérification : l'identifiant de commande ET son numéro.
    if (orderNumber && order.orderNumber !== orderNumber) {
      throw new NotFoundException('Commande introuvable.');
    }

    const payment = await this.prisma.payment.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        status: true,
        amount: true,
        currency: true,
        expiresAt: true,
        paidAt: true,
      },
    });

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
      paid: order.paymentStatus === PaymentStatus.PAID,
      amount: Number(order.total),
      currency: order.currency,
      paidAt: order.paidAt,
      payment: payment
        ? {
            id: payment.id,
            provider: payment.provider,
            status: payment.status,
            amount: Number(payment.amount),
            currency: payment.currency,
            expiresAt: payment.expiresAt,
            paidAt: payment.paidAt,
          }
        : null,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // REDIRECTION DU NAVIGATEUR APRÈS PAIEMENT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Cible de la redirection 302 envoyée au navigateur.
   *
   * Les prestataires redirigent le navigateur vers l'API (URL publique
   * obligatoire) : c'est cette méthode qui produit l'URL finale du front.
   */
  buildCheckoutRedirectTarget(
    kind: string,
    params: { orderId?: string | null; orderNumber?: string | null },
  ): string {
    if (!isCheckoutRedirectKind(kind)) {
      throw new NotFoundException('Page de redirection inconnue.');
    }
    return buildBrowserRedirectUrl(this.browserFrontendUrl, kind, params);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONSULTATION DES PAIEMENTS
  // ─────────────────────────────────────────────────────────────────────────

  async findByOrder(orderId: string, userId?: string) {
    // Un utilisateur connecté ne voit que ses propres commandes ;
    // un invité ne voit que les commandes invitées (userId null).
    const order = await this.prisma.order.findFirst({
      where: userId ? { id: orderId, userId } : { id: orderId, userId: null },
    });

    if (!order) {
      throw new NotFoundException('Commande introuvable.');
    }

    return this.prisma.payment.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { order: true },
    });

    if (!payment) {
      throw new NotFoundException('Enregistrement de paiement introuvable.');
    }

    return payment;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FONCTIONS PRIVEES
  // ─────────────────────────────────────────────────────────────────────────

  /** Dates de vie d'une nouvelle tentative de paiement en ligne. */
  private buildPaymentDeadlines(now = new Date()) {
    const expiresAt = new Date(now.getTime() + this.paymentExpirationMs);
    return {
      expiresAt,
      nextReconciliationAt: new Date(expiresAt.getTime()),
    };
  }

  /**
   * Vérifie un paiement non définitif, puis :
   * - le confirme si Bictorys le donne réussi ;
   * - le marque en échec si Bictorys le donne échoué/expiré ;
   * - le replanifie tant que le délai de grâce n'est pas atteint ;
   * - l'expire (abandon) une fois le délai de grâce dépassé.
   */
  private async reconcilePayment(
    payment: BictorysPaymentWithOrder,
    now: Date,
  ): Promise<'paid' | 'failed' | 'expired' | 'pending'> {
    const expiresAt =
      payment.expiresAt ??
      new Date(payment.createdAt.getTime() + this.paymentExpirationMs);
    const graceDeadline = new Date(
      expiresAt.getTime() + this.paymentExpiryGraceMs,
    );
    const graceReached = now.getTime() >= graceDeadline.getTime();

    if (payment.provider === PaymentProvider.BICTORYS) {
      const inspection = await this.inspectBictorysPayment(payment);

      if (inspection.outcome === 'paid') {
        await this.confirmPayment(
          payment.id,
          payment.orderId,
          'Réconciliation automatique Bictorys',
          {
            bictorysTransactionId:
              inspection.transactionId ?? payment.transactionId,
            bictorysStatus: inspection.status,
            bictorysVerification: inspection.verification ?? 'server',
          },
        );
        return 'paid';
      }

      if (inspection.outcome === 'failed') {
        await this.markPaymentFailed(
          payment.id,
          payment.orderId,
          inspection.reason ?? 'Bictorys : paiement refusé',
        );
        return 'failed';
      }

      if (inspection.outcome === 'expired') {
        await this.markPaymentExpired(
          payment.id,
          payment.orderId,
          inspection.reason ?? 'Bictorys : transaction expirée',
        );
        return 'expired';
      }

      if (graceReached) {
        await this.markPaymentExpired(
          payment.id,
          payment.orderId,
          inspection.reason ??
            'Aucune confirmation de paiement reçue après le délai de grâce.',
        );
        return 'expired';
      }

      await this.scheduleNextReconciliation(
        payment.id,
        this.computeNextReconciliationAt(now, graceDeadline),
        {
          lastReconciliationAt: now.toISOString(),
          lastReconciliationReason:
            inspection.reason ?? 'Paiement toujours en attente.',
        },
      );
      return 'pending';
    }

    if (graceReached) {
      await this.markPaymentExpired(
        payment.id,
        payment.orderId,
        'Aucune confirmation de paiement reçue après le délai de grâce.',
      );
      return 'expired';
    }

    await this.scheduleNextReconciliation(
      payment.id,
      this.computeNextReconciliationAt(now, graceDeadline),
      {
        lastReconciliationAt: now.toISOString(),
        lastReconciliationReason:
          'Vérification automatique du prestataire non disponible.',
      },
    );
    return 'pending';
  }

  /**
   * Interroge Bictorys pour connaître l'état réel d'un paiement.
   * Aucune confirmation ne repose uniquement sur l'absence de webhook.
   */
  private async inspectBictorysPayment(
    payment: BictorysPaymentWithOrder,
  ): Promise<{
    outcome: 'paid' | 'failed' | 'expired' | 'pending';
    reason?: string;
    transactionId?: string | null;
    status?: string | null;
    verification?: 'server' | 'webhook';
  }> {
    const metadata = readMetadata(payment.metadata);
    let transactionId =
      payment.transactionId ??
      (metadata.bictorysTransactionId as string | undefined) ??
      null;
    let transaction: BictorysTransaction | null = null;
    let readForbidden = false;

    if (transactionId) {
      try {
        transaction = await this.bictorysService.getTransaction(transactionId);
      } catch (error) {
        if (!this.bictorysService.isTransactionReadForbidden(error)) {
          return {
            outcome: 'pending',
            reason: `Vérification Bictorys impossible : ${(error as Error).message}`,
          };
        }
        readForbidden = true;
      }
    } else {
      try {
        transaction = await this.bictorysService.findTransactionByReference(
          payment.order.orderNumber,
        );
      } catch (error) {
        return {
          outcome: 'pending',
          reason: `Recherche de la transaction Bictorys impossible : ${(error as Error).message}`,
        };
      }

      if (transaction) {
        transactionId = transaction.id;
        await this.recordBictorysReconciliation(payment, transaction);
      }
    }

    if (
      transaction &&
      !this.bictorysTransactionMatchesOrder(transaction, payment)
    ) {
      return {
        outcome: 'pending',
        reason: `La transaction Bictorys ${transaction.id} ne correspond pas à la commande ${payment.orderId}.`,
        transactionId,
        status: transaction.status,
      };
    }

    if (transaction) {
      if (this.bictorysService.isExpiredStatus(transaction.status)) {
        return {
          outcome: 'expired',
          reason: `Bictorys : statut "${transaction.status}"`,
          transactionId,
          status: transaction.status,
        };
      }

      if (this.bictorysService.isFailedStatus(transaction.status)) {
        return {
          outcome: 'failed',
          reason: `Bictorys : statut "${transaction.status}"`,
          transactionId,
          status: transaction.status,
        };
      }

      if (!this.bictorysService.isSuccessfulStatus(transaction.status)) {
        return {
          outcome: 'pending',
          reason: `Bictorys : statut "${transaction.status}"`,
          transactionId,
          status: transaction.status,
        };
      }

      const check = await this.verifyBictorysTransaction(payment, {
        transactionId: transaction.id,
        webhookAmount: null,
        webhookCurrency: null,
        webhookStatus: transaction.status,
        transaction,
      });

      if (!check.ok) {
        return {
          outcome: 'pending',
          reason: check.reason,
          transactionId,
          status: transaction.status,
        };
      }

      return {
        outcome: 'paid',
        transactionId,
        status: transaction.status,
        verification: check.source ?? 'server',
      };
    }

    if (readForbidden) {
      return {
        outcome: 'pending',
        reason:
          'Lecture des transactions Bictorys refusée par la clé API (vérification serveur indisponible).',
        transactionId,
      };
    }

    return {
      outcome: 'pending',
      reason: `Aucune transaction Bictorys trouvée pour la commande ${payment.order.orderNumber}.`,
      transactionId,
    };
  }

  /** Vérifie que la transaction Bictorys appartient bien à la commande. */
  private bictorysTransactionMatchesOrder(
    transaction: BictorysTransaction,
    payment: BictorysPaymentWithOrder,
  ): boolean {
    const referenceMatches =
      !transaction.paymentReference ||
      transaction.paymentReference === payment.order.orderNumber;
    const merchantMatches =
      !transaction.merchantReference ||
      transaction.merchantReference === payment.order.id;
    return referenceMatches && merchantMatches;
  }

  /** Trace la transaction retrouvée par référence (webhook non reçu). */
  private async recordBictorysReconciliation(
    payment: BictorysPaymentWithOrder,
    transaction: BictorysTransaction,
  ) {
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        transactionId: payment.transactionId ?? transaction.id,
        metadata: mergeMetadata(payment.metadata, {
          bictorysTransactionId:
            payment.transactionId ??
            (readMetadata(payment.metadata).bictorysTransactionId as
              string | undefined) ??
            transaction.id,
          bictorysReconciledAt: new Date().toISOString(),
          bictorysReconciledStatus: transaction.status,
          ...(transaction.pspName ? { pspName: transaction.pspName } : {}),
        }),
      },
    });
  }

  private computeNextReconciliationAt(now: Date, graceDeadline: Date): Date {
    return new Date(
      Math.min(
        now.getTime() + this.reconciliationRetryMs,
        graceDeadline.getTime(),
      ),
    );
  }

  private async scheduleNextReconciliation(
    paymentId: string,
    nextReconciliationAt: Date,
    metadataPatch: Record<string, unknown> = {},
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment || payment.status === PaymentStatus.PAID) {
      return;
    }

    await this.prisma.payment.updateMany({
      where: {
        id: paymentId,
        status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
      },
      data: {
        nextReconciliationAt,
        metadata: mergeMetadata(payment.metadata, metadataPatch),
      },
    });
  }

  /**
   * Marque un paiement abandonné/expiré et annule automatiquement la
   * commande associée (le stock réservé est réintégré).
   */
  private async markPaymentExpired(
    paymentId: string,
    orderId: string,
    reason: string,
  ): Promise<boolean> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (
      !payment ||
      (payment.status !== PaymentStatus.PENDING &&
        payment.status !== PaymentStatus.PROCESSING)
    ) {
      return false;
    }

    const expiredAt = new Date();
    const expired = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.payment.updateMany({
        where: {
          id: paymentId,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING] },
        },
        data: {
          status: PaymentStatus.EXPIRED,
          nextReconciliationAt: null,
          metadata: mergeMetadata(payment.metadata, {
            expirationReason: reason,
            expiredAt: expiredAt.toISOString(),
          }),
        },
      });

      if (updated.count === 0) {
        return false;
      }

      await this.cancelOrderForPaymentFailure(
        tx,
        orderId,
        PaymentStatus.EXPIRED,
        [PaymentStatus.PENDING, PaymentStatus.PROCESSING],
        reason,
      );

      return true;
    });

    if (expired) {
      this.logger.warn(`Paiement ${paymentId} expiré : ${reason}`);
    }

    return expired;
  }

  /**
   * Retrouve le paiement Bictorys associé à une notification, par identifiant
   * de transaction, paymentReference (n° de commande) ou merchantReference
   * (id de commande Hayat Store).
   */
  private async findBictorysPayment(params: {
    transactionId: string | null;
    paymentReference: string | null;
    merchantReference: string | null;
  }): Promise<BictorysPaymentWithOrder | null> {
    const filters: Prisma.PaymentWhereInput[] = [];

    if (params.transactionId) {
      filters.push({ transactionId: params.transactionId });
    }
    if (params.paymentReference) {
      filters.push({ providerReference: params.paymentReference });
      filters.push({ order: { orderNumber: params.paymentReference } });
    }
    if (params.merchantReference) {
      filters.push({ order: { id: params.merchantReference } });
    }

    if (!filters.length) {
      return null;
    }

    return this.prisma.payment.findFirst({
      where: { provider: PaymentProvider.BICTORYS, OR: filters },
      include: { order: true },
    });
  }

  /**
   * Conserve les données de la notification Bictorys sur le paiement :
   * identifiant de transaction, PSP, et montant/devise/statut annoncés.
   * Ces valeurs ne sont écrites qu'après validation de la clé secrète.
   */
  private async persistBictorysTransaction(
    payment: BictorysPaymentWithOrder,
    data: {
      transactionId: string | null;
      pspName: string | null;
      amount?: number | null;
      currency?: string | null;
      status?: string | null;
    },
  ) {
    const hasNotification =
      data.amount !== undefined ||
      data.currency !== undefined ||
      data.status !== undefined;

    if (!data.transactionId && !data.pspName && !hasNotification) {
      return;
    }
    if (payment.transactionId === data.transactionId && !hasNotification) {
      return;
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        transactionId: data.transactionId ?? payment.transactionId,
        metadata: mergeMetadata(payment.metadata, {
          ...(data.transactionId
            ? { bictorysTransactionId: data.transactionId }
            : {}),
          ...(data.pspName ? { pspName: data.pspName } : {}),
          ...(data.amount !== undefined && data.amount !== null
            ? { bictorysWebhookAmount: data.amount }
            : {}),
          ...(data.currency ? { bictorysWebhookCurrency: data.currency } : {}),
          ...(data.status ? { bictorysWebhookStatus: data.status } : {}),
          ...(hasNotification
            ? { bictorysWebhookReceivedAt: new Date().toISOString() }
            : {}),
        }),
      },
    });
  }

  /** Paiement refusé par le prestataire : la commande est annulée. */
  private async markPaymentFailed(
    paymentId: string,
    orderId: string,
    reason: string,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment || payment.status === PaymentStatus.PAID) {
      return;
    }

    const failed = await this.prisma.$transaction(async (tx) => {
      // Un webhook d'échec retardé ne doit jamais écraser un paiement déjà
      // confirmé par une autre notification ou par la réconciliation.
      const updated = await tx.payment.updateMany({
        where: { id: paymentId, status: { not: PaymentStatus.PAID } },
        data: {
          status: PaymentStatus.FAILED,
          nextReconciliationAt: null,
          metadata: mergeMetadata(payment.metadata, {
            failureReason: reason,
            failedAt: new Date().toISOString(),
          }),
        },
      });

      if (updated.count === 0) {
        return false;
      }

      await this.cancelOrderForPaymentFailure(
        tx,
        orderId,
        PaymentStatus.FAILED,
        [
          PaymentStatus.PENDING,
          PaymentStatus.PROCESSING,
          PaymentStatus.EXPIRED,
        ],
        reason,
      );

      return true;
    });

    if (failed) {
      this.logger.warn(`Paiement ${paymentId} échoué : ${reason}`);
    }
  }

  /**
   * Annule la commande liée à un paiement expiré/échoué et réintègre le stock
   * déjà débité à la création de la commande. L'annulation est idempotente :
   * une commande déjà annulée/remboursée/livrée n'est jamais rouverte.
   */
  private async cancelOrderForPaymentFailure(
    tx: Prisma.TransactionClient,
    orderId: string,
    paymentStatus: PaymentStatus,
    allowedPaymentStatuses: PaymentStatus[],
    reason: string,
  ): Promise<boolean> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      return false;
    }

    const canCancel =
      order.status === OrderStatus.PENDING ||
      order.status === OrderStatus.CONFIRMED ||
      order.status === OrderStatus.IN_DELIVERY;
    const canUpdatePaymentStatus = allowedPaymentStatuses.includes(
      order.paymentStatus,
    );

    if (!canCancel && !canUpdatePaymentStatus) {
      return false;
    }

    await tx.order.update({
      where: { id: orderId },
      data: {
        ...(canUpdatePaymentStatus ? { paymentStatus } : {}),
        ...(canCancel ? { status: OrderStatus.CANCELLED } : {}),
      },
    });

    if (canCancel) {
      await this.restoreOrderStock(tx, order, reason);
    }

    return true;
  }

  /** Réintègre le stock des articles d'une commande annulée. */
  private async restoreOrderStock(
    tx: Prisma.TransactionClient,
    order: OrderWithItems,
    reason: string,
  ): Promise<void> {
    for (const item of order.items ?? []) {
      if (!(await this.tracksInventory(tx, item.variantId, item.productId))) {
        continue;
      }

      if (item.variantId) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { quantity: { increment: item.quantity } },
        });
        await this.syncParentStock(tx, item.productId);
      } else {
        await tx.product.update({
          where: { id: item.productId },
          data: { quantity: { increment: item.quantity } },
        });
      }

      await tx.inventoryMovement.create({
        data: {
          quantity: item.quantity,
          type: InventoryMovementType.RETURN,
          reason: `Annulation automatique de la commande ${order.orderNumber} : ${reason}`,
          productId: item.productId,
          variantId: item.variantId,
          referenceId: order.id,
          referenceType: 'ORDER',
          createdById: null,
        },
      });
    }
  }

  /**
   * Re-débite le stock lors de la confirmation tardive d'un paiement après
   * annulation automatique. Retourne false si le stock n'est plus disponible :
   * la commande reste alors annulée pour éviter une survente.
   */
  private async reserveOrderStock(
    tx: Prisma.TransactionClient,
    order: OrderWithItems,
    reason: string,
  ): Promise<boolean> {
    const items = order.items ?? [];
    const trackedItems: Array<{
      item: OrderWithItems['items'][number];
      hasVariant: boolean;
    }> = [];

    for (const item of items) {
      if (item.variantId) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          select: { trackInventory: true, quantity: true },
        });
        if (!variant?.trackInventory) {
          continue;
        }
        if (variant.quantity < item.quantity) {
          return false;
        }
      } else {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { trackInventory: true, quantity: true },
        });
        if (!product?.trackInventory) {
          continue;
        }
        if (product.quantity < item.quantity) {
          return false;
        }
      }

      trackedItems.push({ item, hasVariant: Boolean(item.variantId) });
    }

    for (const { item, hasVariant } of trackedItems) {
      if (hasVariant && item.variantId) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { quantity: { decrement: item.quantity } },
        });
        await this.syncParentStock(tx, item.productId);
      } else {
        await tx.product.update({
          where: { id: item.productId },
          data: { quantity: { decrement: item.quantity } },
        });
      }

      await tx.inventoryMovement.create({
        data: {
          quantity: item.quantity,
          type: InventoryMovementType.SALE,
          reason: `Réouverture de la commande ${order.orderNumber} : ${reason}`,
          productId: item.productId,
          variantId: item.variantId,
          referenceId: order.id,
          referenceType: 'ORDER',
          createdById: null,
        },
      });
    }

    return true;
  }

  /** Indique si le stock est suivi pour un produit ou une variante. */
  private async tracksInventory(
    tx: Prisma.TransactionClient,
    variantId: string | null,
    productId: string,
  ): Promise<boolean> {
    if (variantId) {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: { trackInventory: true },
      });
      return variant?.trackInventory ?? false;
    }

    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { trackInventory: true },
    });
    return product?.trackInventory ?? false;
  }

  /** Garde la quantité du produit parent synchronisée avec ses variantes. */
  private async syncParentStock(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<void> {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { hasVariants: true },
    });

    if (!product?.hasVariants) {
      return;
    }

    const aggregate = await tx.productVariant.aggregate({
      where: { productId },
      _sum: { quantity: true },
    });

    await tx.product.update({
      where: { id: productId },
      data: { quantity: aggregate._sum.quantity ?? 0 },
    });
  }

  /**
   * Paiement received mais non conforme (montant, devise, statut) : on le
   * laisse en PROCESSING et on trace le motif pour une revue manuelle.
   * Un paiement déjà final (EXPIRED, FAILED…) n'est jamais ressuscité.
   */
  private async holdBictorysPayment(paymentId: string, reason: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment || payment.status === PaymentStatus.PAID) {
      return;
    }

    const canReconcile =
      payment.status === PaymentStatus.PENDING ||
      payment.status === PaymentStatus.PROCESSING;

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        ...(canReconcile
          ? {
              status: PaymentStatus.PROCESSING,
              nextReconciliationAt: new Date(
                Date.now() + this.reconciliationRetryMs,
              ),
            }
          : {}),
        metadata: mergeMetadata(payment.metadata, {
          holdReason: reason,
          heldAt: new Date().toISOString(),
        }),
      },
    });
  }

  /**
   * Vérification serveur d'une transaction Bictorys : c'est la source de vérité.
   * Contrôle le statut, la devise et le montant face au total de la commande.
   *
   * Si la clé API utilisée n'a pas le droit de lecture des transactions
   * (clé publique Bictorys), la lecture serveur est impossible : la
   * notification authentifiée par la clé secrète du webhook devient alors la
   * seule source disponible (elle est tracée dans les métadonnées du
   * paiement via `source: 'webhook'`).
   */
  private async verifyBictorysTransaction(
    payment: BictorysPaymentWithOrder,
    context: {
      transactionId: string | null;
      webhookAmount: number | null;
      webhookCurrency: string | null;
      webhookStatus: string | null;
      /** Transaction déjà lue chez Bictorys (évite un second appel API). */
      transaction?: BictorysTransaction | null;
    },
  ): Promise<{ ok: boolean; reason?: string; source?: 'server' | 'webhook' }> {
    const expectedAmount = Number(payment.order.total);
    const expectedCurrency = (payment.order.currency || 'XOF').toUpperCase();

    // 1. Devise annoncée par la notification
    if (
      context.webhookCurrency &&
      context.webhookCurrency.toUpperCase() !== expectedCurrency
    ) {
      return {
        ok: false,
        reason: `Devise du paiement (${context.webhookCurrency}) différente de la devise de la commande (${expectedCurrency})`,
      };
    }

    const amounts: { source: string; value: number }[] = [];
    if (
      context.webhookAmount !== null &&
      Number.isFinite(context.webhookAmount)
    ) {
      amounts.push({ source: 'notification', value: context.webhookAmount });
    }

    // 2. Statut réel de la transaction, interrogé chez Bictorys
    if (!context.transactionId) {
      return {
        ok: false,
        reason: 'Identifiant de transaction Bictorys inconnu',
      };
    }

    const hasPreloadedTransaction = 'transaction' in context;
    let transaction: BictorysTransaction | null = hasPreloadedTransaction
      ? (context.transaction ?? null)
      : null;

    if (!hasPreloadedTransaction) {
      try {
        transaction = await this.bictorysService.getTransaction(
          context.transactionId,
        );
      } catch (error) {
        if (!this.bictorysService.isTransactionReadForbidden(error)) {
          return {
            ok: false,
            reason: `Vérification serveur Bictorys impossible : ${(error as Error).message}`,
          };
        }

        // Clé API sans droit de lecture : la notification authentifiée reste
        // exploitable, mais la confirmation sera marquée comme telle.
        this.logger.warn(
          `Lecture de la transaction Bictorys ${context.transactionId} refusée par l'API (clé API sans droit de lecture) : la confirmation s'appuie sur la notification authentifiée par la clé secrète du webhook.`,
        );
      }
    }

    if (transaction) {
      if (!this.bictorysService.isSuccessfulStatus(transaction.status)) {
        return {
          ok: false,
          reason: `Statut de la transaction Bictorys : "${transaction.status}"`,
        };
      }

      if (
        transaction.currency &&
        transaction.currency.toUpperCase() !== expectedCurrency
      ) {
        return {
          ok: false,
          reason: `Devise de la transaction (${transaction.currency}) différente de la devise de la commande (${expectedCurrency})`,
        };
      }

      if (Number.isFinite(transaction.amount)) {
        amounts.push({ source: 'transaction', value: transaction.amount });
      }
    } else if (
      !this.bictorysService.isSuccessfulStatus(context.webhookStatus)
    ) {
      return {
        ok: false,
        reason: `Statut de la notification Bictorys : "${context.webhookStatus ?? 'inconnu'}"`,
      };
    }

    // 3. Montant : TOUS les montants connus (transaction serveur ET
    // notification) doivent couvrir le total de la commande. Un montant
    // unknown ne vaut pas confirmation (fail-closed).
    if (!amounts.length) {
      return {
        ok: false,
        reason: `Montant de la transaction Bictorys inconnu (total attendu : ${expectedAmount})`,
      };
    }

    const insufficient = amounts.filter(
      (item) => item.value + AMOUNT_TOLERANCE < expectedAmount,
    );

    if (insufficient.length) {
      return {
        ok: false,
        reason: `Montant payé (${amounts
          .map((item) => `${item.value} (${item.source})`)
          .join(' / ')}) inférieur au total de la commande (${expectedAmount})`,
      };
    }

    return { ok: true, source: transaction ? 'server' : 'webhook' };
  }

  /**
   * Confirmation idempotente d'un paiement : la commande n'est marquée payée
   * que si le paiement ne l'était pas déjà (protection contre les doublons
   * de webhook et les appels concurrents).
   */
  private async confirmPayment(
    paymentId: string,
    orderId: string,
    source: string,
    extraMetadata: Record<string, unknown> = {},
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      this.logger.warn(`Paiement ${paymentId} introuvable (${source}).`);
      return;
    }

    if (payment.status === PaymentStatus.PAID) {
      this.logger.log(
        `Paiement ${paymentId} déjà confirmé (${source}) : aucune action.`,
      );
      return;
    }

    const paidAt = new Date();
    const metadata = mergeMetadata(payment.metadata, {
      ...extraMetadata,
      confirmationSource: source,
      confirmedAt: paidAt.toISOString(),
    });

    // Le motif de mise en attente ne vaut plus rien une fois le paiement confirmé.
    delete (metadata as Record<string, unknown>).holdReason;
    delete (metadata as Record<string, unknown>).heldAt;

    let stockReserved = true;

    const confirmed = await this.prisma.$transaction(async (tx) => {
      // Marquer le paiement comme PAID (uniquement s'il ne l'était pas déjà)
      const updated = await tx.payment.updateMany({
        where: { id: paymentId, status: { not: PaymentStatus.PAID } },
        data: {
          status: PaymentStatus.PAID,
          paidAt,
          nextReconciliationAt: null,
          metadata,
        },
      });

      if (updated.count === 0) {
        return false;
      }

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      // Un paiement peut être confirmé après une annulation automatique
      // (webhook tardif) : le stock réintégré doit alors être re-débité.
      let nextStatus: OrderStatus = OrderStatus.CONFIRMED;
      if (order?.status === OrderStatus.CANCELLED) {
        stockReserved = await this.reserveOrderStock(tx, order, source);
        if (!stockReserved) {
          nextStatus = OrderStatus.CANCELLED;
        }
      }

      // Mettre à jour la commande associée
      await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: PaymentStatus.PAID,
          status: nextStatus,
          paidAt,
        },
      });

      return true;
    });

    if (!confirmed) {
      this.logger.log(
        `Paiement ${paymentId} déjà confirmé (${source}) : aucune action.`,
      );
      return;
    }

    if (!stockReserved) {
      this.logger.error(
        `Paiement ${paymentId} confirmé via ${source} mais stock indisponible : la commande ${orderId} reste annulée.`,
      );
    }

    this.logger.log(
      `Paiement ${paymentId} pour la commande ${orderId} confirmé via ${source}`,
    );

    // Notification in-app « paiement reçu »
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
      });
      if (order) {
        await this.notificationsService.notifyPaymentReceived(
          order.id,
          order.orderNumber,
          order.userId ?? undefined,
        );
      }
    } catch (error) {
      this.logger.error(
        `Erreur lors de la notification de paiement pour la commande ${orderId}`,
        error,
      );
    }

    // Evenement PURCHASE (tracking serveur)
    try {
      await this.trackingService.trackPurchase(orderId);
    } catch (error) {
      this.logger.error(
        `Erreur lors du tracking de l'achat pour la commande ${orderId}`,
        error,
      );
    }

    // Envoi automatique de l'email de reçu de paiement
    try {
      const fullOrder = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true, user: true },
      });
      if (fullOrder) {
        await this.mailService.sendPaymentConfirmation(fullOrder);
      }
    } catch (error) {
      this.logger.error(
        `Erreur lors de l'envoi de l'email automatique pour la commande ${orderId}`,
        error,
      );
    }
  }
}

type BictorysPaymentWithOrder = Prisma.PaymentGetPayload<{
  include: { order: true };
}>;

type OrderWithItems = Prisma.OrderGetPayload<{
  include: { items: true };
}>;

/** Statuts considérés comme un paiement réussi. */
const SUCCESS_PROVIDER_STATUSES = new Set([
  'completed',
  'complete',
  'succeeded',
  'success',
  'successful',
  'paid',
  'authorized',
  '00',
]);

/** Statuts d'expiration d'un paiement mobile. */
const EXPIRED_PROVIDER_STATUSES = new Set([
  'expired',
  'expire',
  'timeout',
  'timed_out',
  'timedout',
]);

/** Statuts d'échec d'un paiement mobile. */
const FAILED_PROVIDER_STATUSES = new Set([
  'failed',
  'failure',
  'cancelled',
  'canceled',
  'declined',
  'rejected',
  'error',
  'reversed',
]);

function normalizeProviderStatus(value: unknown): string {
  if (typeof value === 'string') {
    return value
      .trim()
      .toLowerCase()
      .replace(/^checkout\.session\./, '');
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return '';
}

function isProviderSuccessStatus(value: unknown): boolean {
  return SUCCESS_PROVIDER_STATUSES.has(normalizeProviderStatus(value));
}

function resolveFailureKind(...values: unknown[]): 'expired' | 'failed' | null {
  for (const value of values) {
    const status = normalizeProviderStatus(value);
    if (EXPIRED_PROVIDER_STATUSES.has(status)) {
      return 'expired';
    }
    if (FAILED_PROVIDER_STATUSES.has(status)) {
      return 'failed';
    }
  }

  return null;
}

function readMetadata(metadata: unknown): Record<string, any> {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, any>;
  }
  return {};
}

function mergeMetadata(
  existing: unknown,
  patch: Record<string, unknown>,
): Prisma.InputJsonValue {
  return {
    ...readMetadata(existing),
    ...patch,
  };
}

function readPositiveMinutes(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const raw = config.get<string | number>(key);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
