import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShippingMethodDto } from './dto/create-shipping-method.dto';
import { UpdateShipmentStatusDto } from './dto/update-shipment-status.dto';
import { UpdateShippingMethodDto } from './dto/update-shipping-method.dto';

const SHIPMENT_INCLUDE = {
	shippingMethod: true,
	order: {
		select: {
			id: true,
			orderNumber: true,
			status: true,
			paymentStatus: true,
			customerEmail: true,
			customerPhone: true,
			shippingFirstName: true,
			shippingLastName: true,
			shippingAddress: true,
			shippingCity: true,
			shippingRegion: true,
			shippingCountry: true,
			createdAt: true,
		},
	},
} as const;

@Injectable()
export class ShippingService {
	constructor(private readonly prisma: PrismaService) {}

	// ─────────────────────────────────────────────────────────────────────────
	// GESTION DES METHODES DE LIVRAISON (SHIPPING METHODS)
	// ─────────────────────────────────────────────────────────────────────────

	async createMethod(dto: CreateShippingMethodDto) {
		return this.prisma.shippingMethod.create({
			data: {
				name: dto.name,
				description: dto.description,
				price: new Prisma.Decimal(dto.price),
				estimatedMinDays: dto.estimatedMinDays,
				estimatedMaxDays: dto.estimatedMaxDays,
				isActive: dto.isActive ?? true,
			},
		});
	}

	async findAllMethods(includeInactive = false) {
		return this.prisma.shippingMethod.findMany({
			where: includeInactive ? {} : { isActive: true },
			orderBy: { price: 'asc' },
		});
	}

	async findMethodOne(id: string) {
		const method = await this.prisma.shippingMethod.findUnique({
			where: { id },
		});

		if (!method) {
			throw new NotFoundException('Méthode de livraison introuvable.');
		}

		return method;
	}

	async updateMethod(id: string, dto: UpdateShippingMethodDto) {
		await this.findMethodOne(id);

		return this.prisma.shippingMethod.update({
			where: { id },
			data: {
				...(dto.name && { name: dto.name }),
				...(dto.description !== undefined && { description: dto.description }),
				...(dto.price != null && { price: new Prisma.Decimal(dto.price) }),
				...(dto.estimatedMinDays !== undefined && { estimatedMinDays: dto.estimatedMinDays }),
				...(dto.estimatedMaxDays !== undefined && { estimatedMaxDays: dto.estimatedMaxDays }),
				...(dto.isActive !== undefined && { isActive: dto.isActive }),
			},
		});
	}

	async removeMethod(id: string) {
		await this.findMethodOne(id);
		await this.prisma.shippingMethod.delete({ where: { id } });
		return { message: 'Méthode de livraison supprimée avec succès.' };
	}

	// ─────────────────────────────────────────────────────────────────────────
	// SUIVI ET GESTION DES EXPEDITIONS (SHIPMENTS)
	// ─────────────────────────────────────────────────────────────────────────

	async findShipmentByOrder(orderId: string, userId?: string) {
		const shipment = await this.prisma.shipment.findFirst({
			where: {
				OR: [{ id: orderId }, { orderId }, { order: { orderNumber: orderId } }],
				...(userId ? { order: { userId } } : {}),
			},
			include: SHIPMENT_INCLUDE,
		});

		if (!shipment) {
			throw new NotFoundException('Expédition introuvable pour cette commande.');
		}

		return shipment;
	}

	async findShipmentByTrackingNumber(trackingNumber: string) {
		const cleanTracking = trackingNumber.trim();

		const shipment = await this.prisma.shipment.findFirst({
			where: {
				trackingNumber: {
					equals: cleanTracking,
					mode: 'insensitive',
				},
			},
			include: SHIPMENT_INCLUDE,
		});

		if (!shipment) {
			throw new NotFoundException(`Aucun colis trouvé pour le numéro de suivi "${cleanTracking}".`);
		}

		return shipment;
	}

	async updateShipmentStatus(id: string, dto: UpdateShipmentStatusDto) {
		const shipment = await this.prisma.shipment.findFirst({
			where: {
				OR: [{ id }, { orderId: id }, { order: { orderNumber: id } }],
			},
			include: { order: true },
		});

		if (!shipment) {
			throw new NotFoundException('Expédition introuvable.');
		}

		let shippedAt = dto.shippedAt || shipment.shippedAt;
		let deliveredAt = dto.deliveredAt || shipment.deliveredAt;

		if ((dto.status === ShipmentStatus.SHIPPED || dto.status === ShipmentStatus.IN_TRANSIT) && !shippedAt) {
			shippedAt = new Date();
		}

		if (dto.status === ShipmentStatus.DELIVERED && !deliveredAt) {
			deliveredAt = new Date();
		}

		return this.prisma.$transaction(async (tx) => {
			// Mettre à jour l'expédition
			const updatedShipment = await tx.shipment.update({
				where: { id: shipment.id },
				data: {
					status: dto.status,
					...(dto.carrier && { carrier: dto.carrier }),
					...(dto.trackingNumber && { trackingNumber: dto.trackingNumber.trim() }),
					shippedAt,
					deliveredAt,
				},
				include: SHIPMENT_INCLUDE,
			});

			// Synchroniser le statut de la commande associée
			if (dto.status === ShipmentStatus.SHIPPED || dto.status === ShipmentStatus.IN_TRANSIT) {
				if (
					shipment.order.status === OrderStatus.PENDING ||
					shipment.order.status === OrderStatus.CONFIRMED ||
					shipment.order.status === OrderStatus.PROCESSING
				) {
					await tx.order.update({
						where: { id: shipment.orderId },
						data: { status: OrderStatus.SHIPPED },
					});
				}
			} else if (dto.status === ShipmentStatus.DELIVERED) {
				await tx.order.update({
					where: { id: shipment.orderId },
					data: { status: OrderStatus.DELIVERED },
				});
			} else if (dto.status === ShipmentStatus.CANCELLED) {
				await tx.order.update({
					where: { id: shipment.orderId },
					data: { status: OrderStatus.CANCELLED },
				});
			}

			return updatedShipment;
		});
	}
}
