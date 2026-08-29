import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import {
	CartStatus,
	CouponType,
	FulfillmentType,
	InventoryMovementType,
	OrderStatus,
	PaymentStatus,
	Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryDto } from './dto/order-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';

const ORDER_INCLUDE = {
	items: true,
	payments: true,
	deliveryZone: true,
	deliveryNeighborhood: true,
	user: {
		select: {
			id: true,
			email: true,
			firstName: true,
			lastName: true,
			phone: true,
		},
	},
} as const;

import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';

interface ResolvedOrderItem {
	productId: string;
	variantId: string | null;
	productName: string;
	variantName: string | null;
	sku: string | null;
	quantity: number;
	unitPrice: number;
	productSnapshot: Record<string, any>;
}


@Injectable()
export class OrdersService {
	private readonly logger = new Logger(OrdersService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly mailService: MailService,
		private readonly notificationsService: NotificationsService,
	) {}

	// ─────────────────────────────────────────────────────────────────────────
	// CRÉATION DE COMMANDE (CUSTOMER / GUEST)
	// ─────────────────────────────────────────────────────────────────────────

	async create(userId: string | null, dto: CreateOrderDto) {
		// 1. Préparation des articles (depuis panier ou payload direct)
		const resolvedItems = await this.resolveOrderItems(userId, dto);

		if (!resolvedItems.length) {
			throw new BadRequestException('La commande doit contenir au moins un article.');
		}

		// 2. Calcul du sous-total
		const subtotal = resolvedItems.reduce(
			(sum, item) => sum + item.unitPrice * item.quantity,
			0,
		);

		// 3. Calcul des frais de livraison selon le mode de retrait
		let shippingAmount = 0;
		let deliveryZoneId: string | null = null;
		let deliveryNeighborhoodId: string | null = null;

		const fulfillmentType = dto.fulfillmentType || dto.deliveryMethod || FulfillmentType.PICKUP;
		const zoneId = dto.deliveryZoneId || dto.shippingZoneId;
		const neighborhoodId = dto.deliveryNeighborhoodId;

		if (fulfillmentType === FulfillmentType.DELIVERY) {
			if (neighborhoodId) {
				const neighborhood = await this.prisma.deliveryNeighborhood.findFirst({
					where: { id: neighborhoodId, isActive: true },
					include: { deliveryZone: true },
				});

				if (!neighborhood || !neighborhood.deliveryZone || !neighborhood.deliveryZone.isActive) {
					throw new NotFoundException('Quartier de livraison introuvable ou inactif.');
				}

				if (zoneId && zoneId !== neighborhood.deliveryZoneId) {
					throw new BadRequestException(
						"Le quartier sélectionné n'appartient pas à la zone de livraison indiquée.",
					);
				}

				deliveryNeighborhoodId = neighborhood.id;
				deliveryZoneId = neighborhood.deliveryZoneId;
				shippingAmount = Number(neighborhood.deliveryZone.price);
			} else if (zoneId) {
				const zone = await this.prisma.deliveryZone.findFirst({
					where: { id: zoneId, isActive: true },
				});

				if (!zone) {
					throw new NotFoundException('Zone de livraison introuvable ou inactive.');
				}

				shippingAmount = Number(zone.price);
				deliveryZoneId = zone.id;
			} else {
				throw new BadRequestException(
					'Une zone ou un quartier de livraison est requis pour une commande en livraison.',
				);
			}
		} else {
			// Retrait en magasin (PICKUP) : aucun frais de livraison, zone ou quartier
			deliveryNeighborhoodId = null;
			deliveryZoneId = null;
			shippingAmount = 0;
		}

		// 4. Calcul de la réduction (Coupon)
		let couponId: string | null = null;
		let discountAmount = 0;

		if (dto.couponCode) {
			const couponResult = await this.validateAndCalculateCoupon(
				dto.couponCode,
				subtotal,
				shippingAmount,
			);
			couponId = couponResult.couponId;
			discountAmount = couponResult.discountAmount;
		}

		// 5. Calcul de la taxe et du total final
		const taxAmount = 0; // Taxe configurable si nécessaire
		const total = Math.max(0, subtotal - discountAmount + shippingAmount + taxAmount);

		const orderNumber = this.generateOrderNumber();

		// 6. Exécution atomique dans une transaction Prisma
		const order = await this.prisma.$transaction(async (tx) => {
			// A. Créer la commande
			const createdOrder = await tx.order.create({
				data: {
					orderNumber,
					userId,
					status: OrderStatus.PENDING,
					paymentStatus: PaymentStatus.PENDING,
					subtotal: new Prisma.Decimal(subtotal),
					discountAmount: new Prisma.Decimal(discountAmount),
					shippingAmount: new Prisma.Decimal(shippingAmount),
					taxAmount: new Prisma.Decimal(taxAmount),
					total: new Prisma.Decimal(total),
					currency: 'XOF',
					customerEmail: dto.customerEmail,
					customerPhone: dto.customerPhone,
					fulfillmentType,
					deliveryZoneId,
					deliveryNeighborhoodId,
					shippingFirstName: dto.shippingFirstName,
					shippingLastName: dto.shippingLastName,
					shippingPhone: dto.shippingPhone || dto.customerPhone,
					shippingAddress: fulfillmentType === FulfillmentType.DELIVERY ? dto.shippingAddress : null,
					shippingCity: fulfillmentType === FulfillmentType.DELIVERY ? dto.shippingCity : null,
					shippingRegion: fulfillmentType === FulfillmentType.DELIVERY ? dto.shippingRegion : null,
					shippingCountry: fulfillmentType === FulfillmentType.DELIVERY ? dto.shippingCountry || 'SN' : 'SN',
					couponCode: dto.couponCode ? dto.couponCode.toUpperCase() : null,
					notes: dto.notes,
					items: {
						create: resolvedItems.map((item) => ({
							productId: item.productId,
							variantId: item.variantId,
							productName: item.productName,
							variantName: item.variantName,
							sku: item.sku,
							quantity: item.quantity,
							unitPrice: new Prisma.Decimal(item.unitPrice),
							total: new Prisma.Decimal(item.unitPrice * item.quantity),
							productSnapshot: item.productSnapshot,
						})),
					},
				},
			});

			// B. Réserver les stocks et enregistrer les mouvements d'inventaire
			for (const item of resolvedItems) {
				if (item.variantId) {
					await tx.productVariant.update({
						where: { id: item.variantId },
						data: { reservedStock: { increment: item.quantity } },
					});
				} else {
					await tx.product.update({
						where: { id: item.productId },
						data: { reservedStock: { increment: item.quantity } },
					});
				}

				await tx.inventoryMovement.create({
					data: {
						quantity: item.quantity,
						type: InventoryMovementType.RESERVATION,
						reason: `Réservation pour commande ${createdOrder.orderNumber}`,
						productId: item.productId,
						variantId: item.variantId,
						referenceId: createdOrder.id,
						referenceType: 'ORDER',
						createdById: userId,
					},
				});
			}

			// C. Si un coupon a été utilisé, enregistrer son utilisation
			if (couponId) {
				await tx.coupon.update({
					where: { id: couponId },
					data: { usageCount: { increment: 1 } },
				});

				await tx.couponUsage.create({
					data: {
						couponId,
						orderId: createdOrder.id,
						userId,
						discountAmount: new Prisma.Decimal(discountAmount),
					},
				});
			}

			// D. Marquer le panier comme CONVERTED s'il s'agissait d'une commande via panier
			if (dto.cartId) {
				await tx.cart.update({
					where: { id: dto.cartId },
					data: { status: CartStatus.CONVERTED },
				});
			} else if (userId) {
				const activeCart = await tx.cart.findFirst({
					where: { userId, status: CartStatus.ACTIVE },
				});
				if (activeCart) {
					await tx.cart.update({
						where: { id: activeCart.id },
						data: { status: CartStatus.CONVERTED },
					});
				}
			}

			return createdOrder;
		});

		// Envoyer notification aux admins pour nouvelle commande
		await this.notificationsService.notifyOrderCreated(order.id, order.orderNumber, true);

		return this.findOne(order.id);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// ENDPOINTS CLIENTS CONNECTÉS (MY ORDERS)
	// ─────────────────────────────────────────────────────────────────────────

	async findMyOrders(userId: string, query: OrderQueryDto) {
		const page = query.page || 1;
		const limit = query.limit || 10;
		const skip = (page - 1) * limit;

		const where: Prisma.OrderWhereInput = {
			userId,
			...(query.status && { status: query.status }),
			...(query.paymentStatus && { paymentStatus: query.paymentStatus }),
			...(query.fulfillmentType && { fulfillmentType: query.fulfillmentType }),
		};

		const [items, total] = await Promise.all([
			this.prisma.order.findMany({
				where,
				include: ORDER_INCLUDE,
				orderBy: { [query.sortBy || 'createdAt']: query.sortOrder || 'desc' },
				skip,
				take: limit,
			}),
			this.prisma.order.count({ where }),
		]);

		return {
			data: items,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		};
	}

	async findMyOrderById(userId: string, orderId: string) {
		const order = await this.prisma.order.findFirst({
			where: {
				OR: [{ id: orderId }, { orderNumber: orderId }],
				userId,
			},
			include: ORDER_INCLUDE,
		});

		if (!order) {
			throw new NotFoundException('Commande introuvable.');
		}

		return order;
	}

	async cancelMyOrder(userId: string, orderId: string) {
		const order = await this.prisma.order.findFirst({
			where: {
				id: orderId,
				userId,
			},
			include: { items: true },
		});

		if (!order) {
			throw new NotFoundException('Commande introuvable.');
		}

		if (order.status !== OrderStatus.PENDING) {
			throw new BadRequestException(
				`Impossible d'annuler une commande avec le statut "${order.status}". Seules les commandes en attente peuvent être annulées.`,
			);
		}

		await this.prisma.$transaction(async (tx) => {
			// Libérer les stocks réservés
			for (const item of order.items) {
				if (item.variantId) {
					await tx.productVariant.update({
						where: { id: item.variantId },
						data: { reservedStock: { decrement: item.quantity } },
					});
				} else {
					await tx.product.update({
						where: { id: item.productId },
						data: { reservedStock: { decrement: item.quantity } },
					});
				}

				await tx.inventoryMovement.create({
					data: {
						quantity: item.quantity,
						type: InventoryMovementType.RELEASE,
						reason: `Annulation de la commande ${order.orderNumber} par le client`,
						productId: item.productId,
						variantId: item.variantId,
						referenceId: order.id,
						referenceType: 'ORDER',
						createdById: userId,
					},
				});
			}

			// Mettre à jour le statut de la commande
			await tx.order.update({
				where: { id: order.id },
				data: {
					status: OrderStatus.CANCELLED,
					paymentStatus: PaymentStatus.CANCELLED,
				},
			});
		});

		return this.findOne(order.id);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// ENDPOINTS ADMIN / STAFF
	// ─────────────────────────────────────────────────────────────────────────

	async findAll(query: OrderQueryDto) {
		const page = query.page || 1;
		const limit = query.limit || 10;
		const skip = (page - 1) * limit;

		const where: Prisma.OrderWhereInput = {
			...(query.status && { status: query.status }),
			...(query.paymentStatus && { paymentStatus: query.paymentStatus }),
			...(query.fulfillmentType && { fulfillmentType: query.fulfillmentType }),
			...(query.search && {
				OR: [
					{ orderNumber: { contains: query.search, mode: 'insensitive' } },
					{ customerEmail: { contains: query.search, mode: 'insensitive' } },
					{ customerPhone: { contains: query.search } },
					{ shippingFirstName: { contains: query.search, mode: 'insensitive' } },
					{ shippingLastName: { contains: query.search, mode: 'insensitive' } },
				],
			}),
		};

		const [items, total] = await Promise.all([
			this.prisma.order.findMany({
				where,
				include: ORDER_INCLUDE,
				orderBy: { [query.sortBy || 'createdAt']: query.sortOrder || 'desc' },
				skip,
				take: limit,
			}),
			this.prisma.order.count({ where }),
		]);

		return {
			data: items,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		};
	}

	async findOne(id: string) {
		const order = await this.prisma.order.findFirst({
			where: {
				OR: [{ id }, { orderNumber: id }],
			},
			include: ORDER_INCLUDE,
		});

		if (!order) {
			throw new NotFoundException('Commande introuvable.');
		}

		return order;
	}

	async updateStatus(id: string, dto: UpdateOrderStatusDto, staffUserId?: string) {
		const order = await this.prisma.order.findFirst({
			where: {
				OR: [{ id }, { orderNumber: id }],
			},
			include: { items: true },
		});

		if (!order) {
			throw new NotFoundException('Commande introuvable.');
		}

		const previousStatus = order.status;
		const newStatus = dto.status;

		if (previousStatus === newStatus) {
			return this.findOne(id);
		}

		const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
			[OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
			[OrderStatus.CONFIRMED]: [OrderStatus.IN_DELIVERY, OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
			[OrderStatus.IN_DELIVERY]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
			[OrderStatus.DELIVERED]: [OrderStatus.REFUNDED],
			[OrderStatus.CANCELLED]: [],
			[OrderStatus.REFUNDED]: [],
		};

		if (!allowedTransitions[previousStatus].includes(newStatus)) {
			throw new BadRequestException(
				`Transition impossible : ${previousStatus} vers ${newStatus}.`,
			);
		}

		if (
			order.fulfillmentType === FulfillmentType.PICKUP &&
			newStatus === OrderStatus.IN_DELIVERY
		) {
			throw new BadRequestException(
				'Une commande en retrait magasin ne peut pas passer en cours de livraison.',
			);
		}

		await this.prisma.$transaction(async (tx) => {
			// Gestion de la transition de stock selon les statuts
			// Si on passe d'un statut actif vers CANCELLED ou REFUNDED -> Libération ou réintégration du stock
			if (
				(newStatus === OrderStatus.CANCELLED || newStatus === OrderStatus.REFUNDED) &&
				previousStatus !== OrderStatus.CANCELLED &&
				previousStatus !== OrderStatus.REFUNDED
			) {
				for (const item of order.items) {
					if (previousStatus === OrderStatus.PENDING) {
						// Libération de la réservation
						if (item.variantId) {
							await tx.productVariant.update({
								where: { id: item.variantId },
								data: { reservedStock: { decrement: item.quantity } },
							});
						} else {
							await tx.product.update({
								where: { id: item.productId },
								data: { reservedStock: { decrement: item.quantity } },
							});
						}

						await tx.inventoryMovement.create({
							data: {
								quantity: item.quantity,
								type: InventoryMovementType.RELEASE,
								reason: `Commande ${order.orderNumber} annulée/remboursée`,
								productId: item.productId,
								variantId: item.variantId,
								referenceId: order.id,
								referenceType: 'ORDER',
								createdById: staffUserId,
							},
						});
					} else {
						// Si la commande avait déjà été validée/expédiée, on réintègre le stock physique (RETURN)
						if (item.variantId) {
							await tx.productVariant.update({
								where: { id: item.variantId },
								data: { stock: { increment: item.quantity } },
							});
						} else {
							await tx.product.update({
								where: { id: item.productId },
								data: { stock: { increment: item.quantity } },
							});
						}

						await tx.inventoryMovement.create({
							data: {
								quantity: item.quantity,
								type: InventoryMovementType.RETURN,
								reason: `Retour/Annulation commande ${order.orderNumber}`,
								productId: item.productId,
								variantId: item.variantId,
								referenceId: order.id,
								referenceType: 'ORDER',
								createdById: staffUserId,
							},
						});
					}
				}
			} else if (
				previousStatus === OrderStatus.PENDING &&
				(newStatus === OrderStatus.CONFIRMED ||
					newStatus === OrderStatus.IN_DELIVERY)
			) {
				// De PENDING vers CONFIRMED/IN_DELIVERY -> On transforme la réservation en VENTE effective
				for (const item of order.items) {
					if (item.variantId) {
						await tx.productVariant.update({
							where: { id: item.variantId },
							data: {
								stock: { decrement: item.quantity },
								reservedStock: { decrement: item.quantity },
							},
						});
					} else {
						await tx.product.update({
							where: { id: item.productId },
							data: {
								stock: { decrement: item.quantity },
								reservedStock: { decrement: item.quantity },
							},
						});
					}

					await tx.inventoryMovement.create({
						data: {
							quantity: item.quantity,
							type: InventoryMovementType.SALE,
							reason: `Vente confirmée pour commande ${order.orderNumber}`,
							productId: item.productId,
							variantId: item.variantId,
							referenceId: order.id,
							referenceType: 'ORDER',
							createdById: staffUserId,
						},
					});
				}
			}

			// Mise à jour du statut
			await tx.order.update({
				where: { id },
				data: { status: newStatus },
			});
		});

		// Envoyer les notifications appropriées selon le nouveau statut
		switch (newStatus) {
			case OrderStatus.CONFIRMED:
				await this.notificationsService.notifyOrderConfirmed(order.id, order.orderNumber, order.userId || undefined);
				break;
			case OrderStatus.IN_DELIVERY:
				await this.notificationsService.notifyOrderInDelivery(order.id, order.orderNumber, order.userId || undefined);
				break;
			case OrderStatus.DELIVERED:
				await this.notificationsService.notifyOrderDelivered(order.id, order.orderNumber, order.userId || undefined);
				break;
			case OrderStatus.CANCELLED:
				await this.notificationsService.notifyOrderCancelled(order.id, order.orderNumber, order.userId || undefined);
				break;
			case OrderStatus.REFUNDED:
				await this.notificationsService.notifyOrderCancelled(order.id, order.orderNumber, order.userId || undefined);
				break;
		}

		return this.findOne(id);
	}

	async updatePaymentStatus(id: string, dto: UpdatePaymentStatusDto) {
		const order = await this.prisma.order.findUnique({ where: { id } });
		if (!order) {
			throw new NotFoundException('Commande introuvable.');
		}

		const previousStatus = order.paymentStatus;

		await this.prisma.order.update({
			where: { id },
			data: { paymentStatus: dto.status },
		});

		const updatedOrder = await this.findOne(id);

		if (previousStatus !== PaymentStatus.PAID && dto.status === PaymentStatus.PAID) {
			this.mailService.sendPaymentConfirmation(updatedOrder).catch((err) =>
				this.logger.error(`Échec envoi email confirmation paiement commande ${updatedOrder.orderNumber}`, err),
			);
		}

		return updatedOrder;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// METHODES PRIVEES ET HELPERS
	// ─────────────────────────────────────────────────────────────────────────

	private async resolveOrderItems(userId: string | null, dto: CreateOrderDto) {
		const itemsToProcess: Array<{
			productId: string;
			variantId?: string;
			quantity: number;
		}> = [];

		// Scénario A : À partir d'un panier
		if (dto.cartId || (!dto.items?.length && userId)) {
			const cart = await this.prisma.cart.findFirst({
				where: dto.cartId
					? { id: dto.cartId, status: CartStatus.ACTIVE }
					: { userId: userId!, status: CartStatus.ACTIVE },
				include: { items: true },
			});

			if (!cart || !cart.items.length) {
				throw new BadRequestException('Le panier spécifié est vide ou introuvable.');
			}

			for (const cartItem of cart.items) {
				itemsToProcess.push({
					productId: cartItem.productId,
					variantId: cartItem.variantId ?? undefined,
					quantity: cartItem.quantity,
				});
			}
		} else if (dto.items && dto.items.length > 0) {
			// Scénario B : Payload direct d'articles
			itemsToProcess.push(...dto.items);
		} else {
			throw new BadRequestException('Veuillez fournir un panier actif ou des articles à commander.');
		}

		const resolvedItems: ResolvedOrderItem[] = [];

		for (const item of itemsToProcess) {
			const product = await this.prisma.product.findFirst({
				where: { id: item.productId, status: 'ACTIVE' },
				include: {
					images: {
						where: { isPrimary: true },
						take: 1,
					},
				},
			});

			if (!product) {
				throw new NotFoundException(`Le produit avec l'ID ${item.productId} est introuvable ou inactif.`);
			}

			let variant: Awaited<ReturnType<typeof this.prisma.productVariant.findFirst>> = null;
			if (item.variantId) {
				variant = await this.prisma.productVariant.findFirst({
					where: { id: item.variantId, productId: item.productId, isActive: true },
				});

				if (!variant) {
					throw new NotFoundException(`La variante ${item.variantId} pour le produit ${product.name} est introuvable ou inactive.`);
				}
			}

			// Vérification de la disponibilité du stock
			const availableStock = variant
				? variant.stock - variant.reservedStock
				: product.stock - product.reservedStock;

			if (item.quantity > availableStock) {
				const itemName = variant ? `${product.name} (${variant.name || variant.sku})` : product.name;
				throw new BadRequestException(
					`Stock insuffisant pour le produit "${itemName}". Stock disponible : ${availableStock}`,
				);
			}

			const unitPrice = variant?.price ? Number(variant.price) : Number(product.price);
			const sku = variant?.sku || product.sku || null;
			const imageUrl = product.images?.[0]?.url || null;

			resolvedItems.push({
				productId: product.id,
				variantId: variant?.id || null,
				productName: product.name,
				variantName: variant?.name || null,
				sku,
				quantity: item.quantity,
				unitPrice,
				productSnapshot: {
					productId: product.id,
					name: product.name,
					variantId: variant?.id || null,
					variantName: variant?.name || null,
					sku,
					price: unitPrice,
					imageUrl,
				},
			});
		}

		return resolvedItems;
	}

	private async validateAndCalculateCoupon(
		code: string,
		subtotal: number,
		shippingAmount: number,
	) {
		const coupon = await this.prisma.coupon.findFirst({
			where: {
				code: code.toUpperCase(),
				isActive: true,
			},
		});

		if (!coupon) {
			throw new BadRequestException(`Le code promo "${code}" est invalide.`);
		}

		const now = new Date();
		if (coupon.startsAt && coupon.startsAt > now) {
			throw new BadRequestException(`Le code promo "${code}" n'est pas encore actif.`);
		}
		if (coupon.expiresAt && coupon.expiresAt < now) {
			throw new BadRequestException(`Le code promo "${code}" a expiré.`);
		}

		if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
			throw new BadRequestException(`Le code promo "${code}" a atteint sa limite d'utilisation.`);
		}

		if (coupon.minimumOrderAmount && subtotal < Number(coupon.minimumOrderAmount)) {
			throw new BadRequestException(
				`Le montant minimum d'achat pour utiliser le code promo "${code}" est de ${coupon.minimumOrderAmount} XOF.`,
			);
		}

		let discountAmount = 0;
		const couponValue = Number(coupon.value);

		if (coupon.type === CouponType.PERCENTAGE) {
			discountAmount = (subtotal * couponValue) / 100;
			if (coupon.maximumDiscount && discountAmount > Number(coupon.maximumDiscount)) {
				discountAmount = Number(coupon.maximumDiscount);
			}
		} else if (coupon.type === CouponType.FIXED_AMOUNT) {
			discountAmount = Math.min(couponValue, subtotal);
		} else if (coupon.type === CouponType.FREE_SHIPPING) {
			discountAmount = shippingAmount;
		}

		return {
			couponId: coupon.id,
			discountAmount: Math.round(discountAmount * 100) / 100,
		};
	}

	private generateOrderNumber(): string {
		const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
		const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
		return `ORD-${dateStr}-${randomStr}`;
	}
}
