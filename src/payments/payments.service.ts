import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
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

  async handleWaveWebhook(signature: string, rawBody: string, payload: any) {
    const isValid = this.waveService.verifyWebhookSignature(signature, rawBody);
    if (!isValid) {
      this.logger.error('Signature Wave Webhook invalide');
      throw new UnauthorizedException('Signature Webhook invalide.');
    }

    this.logger.log(`Webhook Wave reçu : ${JSON.stringify(payload)}`);

    const eventType = payload.type || payload.event;
    const data = payload.data || payload;

    if (eventType === 'checkout.session.completed') {
      const transactionId = data.id;
      const clientReference = data.client_reference;

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
    }

    return { received: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WEBHOOK ORANGE MONEY
  // ─────────────────────────────────────────────────────────────────────────

  async handleOrangeMoneyWebhook(payload: any, signature?: string) {
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

    const status = payload.status || payload.status_payment;
    const orderIdRef = payload.order_id || payload.reference;
    const payToken = payload.pay_token || payload.notif_token || payload.txnid;

    if (
      status === 'SUCCESS' ||
      status === 'PAID' ||
      status === '00' ||
      status === 'SUCCESSFUL'
    ) {
      const payment = await this.prisma.payment.findFirst({
        where: {
          OR: [
            { transactionId: payToken },
            { providerReference: payToken },
            { order: { orderNumber: orderIdRef } },
          ],
        },
        include: { order: true },
      });

      if (payment && payment.status !== PaymentStatus.PAID) {
        await this.confirmPayment(
          payment.id,
          payment.orderId,
          'Orange Money Webhook',
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

    if (this.bictorysService.isFailedStatus(status)) {
      await this.markBictorysPaymentFailed(
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
      include: { payments: true },
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

    if (!transactionId) {
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
        transactionId,
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
        bictorysTransactionId: transactionId,
        bictorysVerification: check.source ?? 'server',
      },
    );

    return {
      confirmed: true,
      status: PaymentStatus.PAID,
      orderStatus: OrderStatus.CONFIRMED,
    };
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

  /** Paiement refusé par Bictorys : la commande n'est pas payée. */
  private async markBictorysPaymentFailed(
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

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: PaymentStatus.FAILED,
          metadata: mergeMetadata(payment.metadata, {
            failureReason: reason,
            failedAt: new Date().toISOString(),
          }),
        },
      });

      await tx.order.updateMany({
        where: {
          id: orderId,
          paymentStatus: {
            in: [PaymentStatus.PENDING, PaymentStatus.PROCESSING],
          },
        },
        data: { paymentStatus: PaymentStatus.FAILED },
      });
    });

    this.logger.warn(`Paiement Bictorys ${paymentId} échoué : ${reason}`);
  }

  /**
   * Paiement received mais non conforme (montant, devise, statut) : on le
   * laisse en PROCESSING et on trace le motif pour une revue manuelle.
   */
  private async holdBictorysPayment(paymentId: string, reason: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment || payment.status === PaymentStatus.PAID) {
      return;
    }

    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.PROCESSING,
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

    let transaction: BictorysTransaction | null = null;
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

    const confirmed = await this.prisma.$transaction(async (tx) => {
      // Marquer le paiement comme PAID (uniquement s'il ne l'était pas déjà)
      const updated = await tx.payment.updateMany({
        where: { id: paymentId, status: { not: PaymentStatus.PAID } },
        data: {
          status: PaymentStatus.PAID,
          paidAt,
          metadata,
        },
      });

      if (updated.count === 0) {
        return false;
      }

      // Mettre à jour la commande associée
      await tx.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: PaymentStatus.PAID,
          status: OrderStatus.CONFIRMED,
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
