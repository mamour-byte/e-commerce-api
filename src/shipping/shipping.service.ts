import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';

@Injectable()
export class ShippingService {
	constructor(private readonly prisma: PrismaService) {}

	async createZone(dto: CreateDeliveryZoneDto) {
		return this.prisma.deliveryZone.create({
			data: {
				name: dto.name,
				description: dto.description,
				price: new Prisma.Decimal(dto.price),
				sortOrder: dto.sortOrder ?? 0,
				isActive: dto.isActive ?? true,
			},
		});
	}

	async findAllZones(includeInactive = false) {
		return this.prisma.deliveryZone.findMany({
			where: includeInactive ? {} : { isActive: true },
			orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
		});
	}

	async findZoneOne(id: string) {
		const zone = await this.prisma.deliveryZone.findUnique({
			where: { id },
		});

		if (!zone) {
			throw new NotFoundException('Zone de livraison introuvable.');
		}

		return zone;
	}

	async findActiveZone(id: string) {
		const zone = await this.prisma.deliveryZone.findFirst({
			where: { id, isActive: true },
		});

		if (!zone) {
			throw new NotFoundException('Zone de livraison introuvable ou inactive.');
		}

		return zone;
	}

	async updateZone(id: string, dto: UpdateDeliveryZoneDto) {
		await this.findZoneOne(id);

		return this.prisma.deliveryZone.update({
			where: { id },
			data: {
				...(dto.name && { name: dto.name }),
				...(dto.description !== undefined && { description: dto.description }),
				...(dto.price != null && { price: new Prisma.Decimal(dto.price) }),
				...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
				...(dto.isActive !== undefined && { isActive: dto.isActive }),
			},
		});
	}

	async removeZone(id: string) {
		await this.findZoneOne(id);

		const ordersCount = await this.prisma.order.count({
			where: { deliveryZoneId: id },
		});

		if (ordersCount > 0) {
			throw new BadRequestException(
				'Impossible de supprimer une zone utilisée par des commandes. Désactivez-la plutôt.',
			);
		}

		await this.prisma.deliveryZone.delete({ where: { id } });
		return { message: 'Zone de livraison supprimée avec succès.' };
	}
}
