import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common';
import { OrderStatus, PaymentProvider, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { OrangeMoneyService } from './providers/orange-money.service';
import { WaveService } from './providers/wave.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class PaymentsService {
	private readonly logger = new Logger(PaymentsService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly waveService: WaveService,
		private readonly orangeMoneyService: OrangeMoneyService,
		private readonly mailService: MailService,
	) {}

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

		if (order.paymentStatus === PaymentStatus.PAID) {
			throw new BadRequestException('Cette commande a déjà été payée.');
		}

		if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) {
			throw new BadRequestException(`Impossible d'initier un paiement pour une commande ${order.status.toLowerCase()}.`);
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
						providerReference: waveSession.client_reference || order.orderNumber,
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
					message: 'Commande enregistrée avec succès. Le paiement sera effectué en espèces à la livraison.',
				};
			}

			default:
				throw new BadRequestException(`Fournisseur de paiement "${dto.provider}" non pris en charge.`);
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

	async handleOrangeMoneyWebhook(payload: any) {
		this.logger.log(`Webhook Orange Money reçu : ${JSON.stringify(payload)}`);

		const status = payload.status || payload.status_payment;
		const orderIdRef = payload.order_id || payload.reference;
		const payToken = payload.pay_token || payload.notif_token || payload.txnid;

		if (status === 'SUCCESS' || status === 'PAID' || status === '00' || status === 'SUCCESSFUL') {
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
				await this.confirmPayment(payment.id, payment.orderId, 'Orange Money Webhook');
			}
		}

		return { status: 'OK' };
	}

	// ─────────────────────────────────────────────────────────────────────────
	// CONSULTATION DES PAIEMENTS
	// ─────────────────────────────────────────────────────────────────────────

	async findByOrder(orderId: string, userId?: string) {
		const order = await this.prisma.order.findFirst({
			where: {
				id: orderId,
				...(userId ? { userId } : {}),
			},
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

	private async confirmPayment(paymentId: string, orderId: string, source: string) {
		await this.prisma.$transaction(async (tx) => {
			// Marquer le paiement comme PAID
			await tx.payment.update({
				where: { id: paymentId },
				data: {
					status: PaymentStatus.PAID,
					paidAt: new Date(),
					metadata: {
						confirmationSource: source,
						confirmedAt: new Date().toISOString(),
					},
				},
			});

			// Mettre à jour la commande associée
			await tx.order.update({
				where: { id: orderId },
				data: {
					paymentStatus: PaymentStatus.PAID,
					status: OrderStatus.CONFIRMED,
				},
			});
		});

		this.logger.log(`Paiement ${paymentId} pour la commande ${orderId} confirmé via ${source}`);

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
			this.logger.error(`Erreur lors de l'envoi de l'email automatique pour la commande ${orderId}`, error);
		}
	}
}
