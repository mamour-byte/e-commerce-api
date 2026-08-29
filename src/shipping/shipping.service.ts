import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeliveryNeighborhoodDto } from './dto/create-delivery-neighborhood.dto';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryNeighborhoodDto } from './dto/update-delivery-neighborhood.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';

@Injectable()
export class ShippingService {
	constructor(private readonly prisma: PrismaService) {}

	// ─────────────────────────────────────────────────────────────────────────
	// ZONES DE LIVRAISON
	// ─────────────────────────────────────────────────────────────────────────

	async createZone(dto: CreateDeliveryZoneDto) {
		const neighborhoodData = dto.neighborhoods
			?.map((n) => n.trim())
			.filter(Boolean)
			.map((name) => ({ name, isActive: true }));

		return this.prisma.deliveryZone.create({
			data: {
				name: dto.name,
				description: dto.description,
				price: new Prisma.Decimal(dto.price),
				sortOrder: dto.sortOrder ?? 0,
				isActive: dto.isActive ?? true,
				...(neighborhoodData && neighborhoodData.length > 0 && {
					neighborhoods: {
						create: neighborhoodData,
					},
				}),
			},
			include: {
				neighborhoods: {
					orderBy: { name: 'asc' },
				},
			},
		});
	}

	async findAllZones(includeInactive = false) {
		return this.prisma.deliveryZone.findMany({
			where: includeInactive ? {} : { isActive: true },
			include: {
				neighborhoods: {
					where: includeInactive ? {} : { isActive: true },
					orderBy: { name: 'asc' },
				},
			},
			orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
		});
	}

	async findZoneOne(id: string) {
		const zone = await this.prisma.deliveryZone.findUnique({
			where: { id },
			include: {
				neighborhoods: {
					orderBy: { name: 'asc' },
				},
			},
		});

		if (!zone) {
			throw new NotFoundException('Zone de livraison introuvable.');
		}

		return zone;
	}

	async findActiveZone(id: string) {
		const zone = await this.prisma.deliveryZone.findFirst({
			where: { id, isActive: true },
			include: {
				neighborhoods: {
					where: { isActive: true },
					orderBy: { name: 'asc' },
				},
			},
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
			include: {
				neighborhoods: {
					orderBy: { name: 'asc' },
				},
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

	// ─────────────────────────────────────────────────────────────────────────
	// QUARTIERS DE LIVRAISON (NEIGHBORHOODS)
	// ─────────────────────────────────────────────────────────────────────────

	async findAllNeighborhoods(includeInactive = false, zoneId?: string) {
		return this.prisma.deliveryNeighborhood.findMany({
			where: {
				...(includeInactive
					? {}
					: { isActive: true, deliveryZone: { isActive: true } }),
				...(zoneId ? { deliveryZoneId: zoneId } : {}),
			},
			include: {
				deliveryZone: {
					select: {
						id: true,
						name: true,
						price: true,
						isActive: true,
					},
				},
			},
			orderBy: [{ name: 'asc' }],
		});
	}

	async findNeighborhoodOne(id: string) {
		const neighborhood = await this.prisma.deliveryNeighborhood.findUnique({
			where: { id },
			include: {
				deliveryZone: true,
			},
		});

		if (!neighborhood) {
			throw new NotFoundException('Quartier de livraison introuvable.');
		}

		return neighborhood;
	}

	async findActiveNeighborhood(id: string) {
		const neighborhood = await this.prisma.deliveryNeighborhood.findFirst({
			where: {
				id,
				isActive: true,
				deliveryZone: { isActive: true },
			},
			include: {
				deliveryZone: true,
			},
		});

		if (!neighborhood) {
			throw new NotFoundException(
				'Quartier de livraison introuvable ou inactif.',
			);
		}

		return neighborhood;
	}

	async createNeighborhood(dto: CreateDeliveryNeighborhoodDto) {
		const zone = await this.prisma.deliveryZone.findUnique({
			where: { id: dto.deliveryZoneId },
		});

		if (!zone) {
			throw new NotFoundException('Zone de livraison introuvable.');
		}

		if (dto.names && dto.names.length > 0) {
			const names = dto.names.map((n) => n.trim()).filter(Boolean);
			if (names.length === 0) {
				throw new BadRequestException('Au moins un nom de quartier valide est requis.');
			}

			const created = await this.prisma.$transaction(
				names.map((name) =>
					this.prisma.deliveryNeighborhood.create({
						data: {
							name,
							deliveryZoneId: dto.deliveryZoneId,
							isActive: dto.isActive ?? true,
						},
						include: {
							deliveryZone: true,
						},
					}),
				),
			);
			return created;
		}

		if (!dto.name || !dto.name.trim()) {
			throw new BadRequestException('Le nom du quartier est requis.');
		}

		return this.prisma.deliveryNeighborhood.create({
			data: {
				name: dto.name.trim(),
				deliveryZoneId: dto.deliveryZoneId,
				isActive: dto.isActive ?? true,
			},
			include: {
				deliveryZone: true,
			},
		});
	}

	async updateNeighborhood(id: string, dto: UpdateDeliveryNeighborhoodDto) {
		await this.findNeighborhoodOne(id);

		if (dto.deliveryZoneId) {
			const zone = await this.prisma.deliveryZone.findUnique({
				where: { id: dto.deliveryZoneId },
			});
			if (!zone) {
				throw new NotFoundException('Zone de livraison introuvable.');
			}
		}

		return this.prisma.deliveryNeighborhood.update({
			where: { id },
			data: {
				...(dto.name && { name: dto.name.trim() }),
				...(dto.deliveryZoneId && { deliveryZoneId: dto.deliveryZoneId }),
				...(dto.isActive !== undefined && { isActive: dto.isActive }),
			},
			include: {
				deliveryZone: true,
			},
		});
	}

	async removeNeighborhood(id: string) {
		await this.findNeighborhoodOne(id);

		const ordersCount = await this.prisma.order.count({
			where: { deliveryNeighborhoodId: id },
		});

		if (ordersCount > 0) {
			throw new BadRequestException(
				'Impossible de supprimer un quartier associé à des commandes existantes. Désactivez-le plutôt.',
			);
		}

		await this.prisma.deliveryNeighborhood.delete({ where: { id } });
		return { message: 'Quartier de livraison supprimé avec succès.' };
	}
}
