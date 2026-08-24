import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { CouponType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CouponQueryDto } from './dto/coupon-query.dto';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ValidateCouponDto } from './dto/validate-coupon.dto';

@Injectable()
export class CouponsService {
	constructor(private readonly prisma: PrismaService) {}

	// ─────────────────────────────────────────────────────────────────────────
	// CRÉATION D'UN COUPON (ADMIN)
	// ─────────────────────────────────────────────────────────────────────────

	async create(dto: CreateCouponDto) {
		const formattedCode = dto.code.trim().toUpperCase();

		const existing = await this.prisma.coupon.findUnique({
			where: { code: formattedCode },
		});

		if (existing) {
			throw new ConflictException(`Un coupon avec le code "${formattedCode}" existe déjà.`);
		}

		if (dto.type === CouponType.PERCENTAGE && (dto.value <= 0 || dto.value > 100)) {
			throw new BadRequestException('Pour une réduction en pourcentage, la valeur doit être comprise entre 1 et 100.');
		}

		return this.prisma.coupon.create({
			data: {
				code: formattedCode,
				description: dto.description,
				type: dto.type,
				value: new Prisma.Decimal(dto.value),
				minimumOrderAmount: dto.minimumOrderAmount != null ? new Prisma.Decimal(dto.minimumOrderAmount) : null,
				maximumDiscount: dto.maximumDiscount != null ? new Prisma.Decimal(dto.maximumDiscount) : null,
				usageLimit: dto.usageLimit ?? null,
				startsAt: dto.startsAt ?? null,
				expiresAt: dto.expiresAt ?? null,
				isActive: dto.isActive ?? true,
			},
		});
	}

	// ─────────────────────────────────────────────────────────────────────────
	// LISTER LES COUPONS (ADMIN / STAFF)
	// ─────────────────────────────────────────────────────────────────────────

	async findAll(query: CouponQueryDto) {
		const page = query.page || 1;
		const limit = query.limit || 10;
		const skip = (page - 1) * limit;

		const where: Prisma.CouponWhereInput = {
			...(query.type && { type: query.type }),
			...(query.isActive !== undefined && { isActive: query.isActive }),
			...(query.search && {
				OR: [
					{ code: { contains: query.search, mode: 'insensitive' } },
					{ description: { contains: query.search, mode: 'insensitive' } },
				],
			}),
		};

		const [items, total] = await Promise.all([
			this.prisma.coupon.findMany({
				where,
				orderBy: { [query.sortBy || 'createdAt']: query.sortOrder || 'desc' },
				skip,
				take: limit,
			}),
			this.prisma.coupon.count({ where }),
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

	// ─────────────────────────────────────────────────────────────────────────
	// CONSULTER UN COUPON PAR ID OU CODE
	// ─────────────────────────────────────────────────────────────────────────

	async findOne(idOrCode: string) {
		const coupon = await this.prisma.coupon.findFirst({
			where: {
				OR: [
					{ id: idOrCode },
					{ code: idOrCode.toUpperCase() },
				],
			},
			include: {
				_count: {
					select: { usages: true },
				},
			},
		});

		if (!coupon) {
			throw new NotFoundException('Coupon introuvable.');
		}

		return coupon;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// TEST / VALIDATION D'UN COUPON (PUBLIC CLIENT)
	// ─────────────────────────────────────────────────────────────────────────

	async validate(dto: ValidateCouponDto) {
		const formattedCode = dto.code.trim().toUpperCase();

		const coupon = await this.prisma.coupon.findUnique({
			where: { code: formattedCode },
		});

		if (!coupon || !coupon.isActive) {
			throw new BadRequestException(`Le code promo "${formattedCode}" est invalide ou inactif.`);
		}

		const now = new Date();
		if (coupon.startsAt && coupon.startsAt > now) {
			throw new BadRequestException(`Le code promo "${formattedCode}" n'est pas encore actif.`);
		}
		if (coupon.expiresAt && coupon.expiresAt < now) {
			throw new BadRequestException(`Le code promo "${formattedCode}" a expiré.`);
		}

		if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
			throw new BadRequestException(`Le code promo "${formattedCode}" a atteint sa limite d'utilisation.`);
		}

		const minOrder = coupon.minimumOrderAmount ? Number(coupon.minimumOrderAmount) : 0;
		if (minOrder > 0 && dto.subtotal < minOrder) {
			throw new BadRequestException(
				`Le montant minimum d'achat pour ce code promo est de ${minOrder} XOF.`,
			);
		}

		let discountAmount = 0;
		const couponValue = Number(coupon.value);
		const shippingAmount = dto.shippingAmount || 0;

		if (coupon.type === CouponType.PERCENTAGE) {
			discountAmount = (dto.subtotal * couponValue) / 100;
			if (coupon.maximumDiscount && discountAmount > Number(coupon.maximumDiscount)) {
				discountAmount = Number(coupon.maximumDiscount);
			}
		} else if (coupon.type === CouponType.FIXED_AMOUNT) {
			discountAmount = Math.min(couponValue, dto.subtotal);
		} else if (coupon.type === CouponType.FREE_SHIPPING) {
			discountAmount = shippingAmount;
		}

		discountAmount = Math.round(discountAmount * 100) / 100;

		return {
			isValid: true,
			coupon: {
				id: coupon.id,
				code: coupon.code,
				description: coupon.description,
				type: coupon.type,
				value: Number(coupon.value),
			},
			discountAmount,
			subtotal: dto.subtotal,
			shippingAmount,
			newTotal: Math.max(0, dto.subtotal - discountAmount + shippingAmount),
		};
	}

	// ─────────────────────────────────────────────────────────────────────────
	// MODIFIER UN COUPON (ADMIN)
	// ─────────────────────────────────────────────────────────────────────────

	async update(id: string, dto: UpdateCouponDto) {
		const coupon = await this.prisma.coupon.findUnique({ where: { id } });
		if (!coupon) {
			throw new NotFoundException('Coupon introuvable.');
		}

		if (dto.code) {
			const formattedCode = dto.code.trim().toUpperCase();
			if (formattedCode !== coupon.code) {
				const existing = await this.prisma.coupon.findUnique({
					where: { code: formattedCode },
				});
				if (existing) {
					throw new ConflictException(`Un coupon avec le code "${formattedCode}" existe déjà.`);
				}
			}
		}

		if (dto.type === CouponType.PERCENTAGE && dto.value != null && (dto.value <= 0 || dto.value > 100)) {
			throw new BadRequestException('Pour une réduction en pourcentage, la valeur doit être comprise entre 1 et 100.');
		}

		return this.prisma.coupon.update({
			where: { id },
			data: {
				...(dto.code && { code: dto.code.trim().toUpperCase() }),
				...(dto.description !== undefined && { description: dto.description }),
				...(dto.type && { type: dto.type }),
				...(dto.value != null && { value: new Prisma.Decimal(dto.value) }),
				...(dto.minimumOrderAmount !== undefined && {
					minimumOrderAmount: dto.minimumOrderAmount != null ? new Prisma.Decimal(dto.minimumOrderAmount) : null,
				}),
				...(dto.maximumDiscount !== undefined && {
					maximumDiscount: dto.maximumDiscount != null ? new Prisma.Decimal(dto.maximumDiscount) : null,
				}),
				...(dto.usageLimit !== undefined && { usageLimit: dto.usageLimit }),
				...(dto.startsAt !== undefined && { startsAt: dto.startsAt }),
				...(dto.expiresAt !== undefined && { expiresAt: dto.expiresAt }),
				...(dto.isActive !== undefined && { isActive: dto.isActive }),
			},
		});
	}

	// ─────────────────────────────────────────────────────────────────────────
	// SUPPRIMER UN COUPON (ADMIN)
	// ─────────────────────────────────────────────────────────────────────────

	async remove(id: string) {
		const coupon = await this.prisma.coupon.findUnique({ where: { id } });
		if (!coupon) {
			throw new NotFoundException('Coupon introuvable.');
		}

		await this.prisma.coupon.delete({ where: { id } });
		return { message: `Le coupon ${coupon.code} a été supprimé.` };
	}

	// ─────────────────────────────────────────────────────────────────────────
	// HISTORIQUE D'UTILISATION (ADMIN)
	// ─────────────────────────────────────────────────────────────────────────

	async getUsages(id: string, page = 1, limit = 10) {
		const coupon = await this.prisma.coupon.findUnique({ where: { id } });
		if (!coupon) {
			throw new NotFoundException('Coupon introuvable.');
		}

		const skip = (page - 1) * limit;

		const [items, total] = await Promise.all([
			this.prisma.couponUsage.findMany({
				where: { couponId: id },
				include: {
					order: {
						select: {
							id: true,
							orderNumber: true,
							total: true,
							status: true,
							createdAt: true,
						},
					},
				},
				orderBy: { createdAt: 'desc' },
				skip,
				take: limit,
			}),
			this.prisma.couponUsage.count({ where: { couponId: id } }),
		]);

		return {
			coupon: { id: coupon.id, code: coupon.code, usageCount: coupon.usageCount },
			data: items,
			meta: {
				total,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		};
	}
}
