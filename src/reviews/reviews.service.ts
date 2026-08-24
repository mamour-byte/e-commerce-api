import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { Prisma, ReviewStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewQueryDto } from './dto/review-query.dto';
import { UpdateReviewStatusDto } from './dto/update-review-status.dto';

const REVIEW_USER_SELECT = {
	id: true,
	firstName: true,
	lastName: true,
} as const;

@Injectable()
export class ReviewsService {
	constructor(private readonly prisma: PrismaService) {}

	// ─────────────────────────────────────────────────────────────────────────
	// DEPOSER UN AVIS (CLIENT CONNECTE)
	// ─────────────────────────────────────────────────────────────────────────

	async create(userId: string, dto: CreateReviewDto) {
		const product = await this.prisma.product.findUnique({
			where: { id: dto.productId },
		});

		if (!product) {
			throw new NotFoundException('Produit introuvable.');
		}

		if (dto.orderId) {
			const order = await this.prisma.order.findFirst({
				where: { id: dto.orderId, userId },
			});
			if (!order) {
				throw new BadRequestException('La commande spécifiée n\'existe pas ou ne vous appartient pas.');
			}
		}

		// Vérifier si l'utilisateur a déjà déposé un avis pour ce produit
		const existingReview = await this.prisma.review.findFirst({
			where: { userId, productId: dto.productId },
		});

		if (existingReview) {
			throw new BadRequestException('Vous avez déjà déposé un avis pour ce produit.');
		}

		return this.prisma.review.create({
			data: {
				productId: dto.productId,
				userId,
				orderId: dto.orderId,
				rating: dto.rating,
				title: dto.title,
				comment: dto.comment,
				status: ReviewStatus.PENDING, // En attente de modération
			},
			include: {
				user: { select: REVIEW_USER_SELECT },
			},
		});
	}

	// ─────────────────────────────────────────────────────────────────────────
	// OBTENIR LES AVIS APPROUVES D'UN PRODUIT (PUBLIC CLIENT)
	// ─────────────────────────────────────────────────────────────────────────

	async findProductApprovedReviews(productId: string, page = 1, limit = 10) {
		const skip = (page - 1) * limit;

		const where: Prisma.ReviewWhereInput = {
			productId,
			status: ReviewStatus.APPROVED,
		};

		const [items, total, aggregateResult, groupResult] = await Promise.all([
			this.prisma.review.findMany({
				where,
				include: {
					user: { select: REVIEW_USER_SELECT },
				},
				orderBy: { createdAt: 'desc' },
				skip,
				take: limit,
			}),
			this.prisma.review.count({ where }),
			this.prisma.review.aggregate({
				where,
				_avg: { rating: true },
			}),
			this.prisma.review.groupBy({
				by: ['rating'],
				where,
				_count: { rating: true },
			}),
		]);

		const ratingBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
		for (const group of groupResult) {
			ratingBreakdown[group.rating as keyof typeof ratingBreakdown] = group._count.rating;
		}

		const averageRating = aggregateResult._avg.rating
			? Math.round(aggregateResult._avg.rating * 10) / 10
			: 0;

		return {
			data: items,
			meta: {
				total,
				averageRating,
				ratingBreakdown,
				page,
				limit,
				totalPages: Math.ceil(total / limit),
			},
		};
	}

	// ─────────────────────────────────────────────────────────────────────────
	// LISTER TOUS LES AVIS POUR MODERATION (ADMIN / STAFF)
	// ─────────────────────────────────────────────────────────────────────────

	async findAllAdmin(query: ReviewQueryDto) {
		const page = query.page || 1;
		const limit = query.limit || 10;
		const skip = (page - 1) * limit;

		const where: Prisma.ReviewWhereInput = {
			...(query.productId && { productId: query.productId }),
			...(query.status && { status: query.status }),
			...(query.rating && { rating: query.rating }),
		};

		const [items, total] = await Promise.all([
			this.prisma.review.findMany({
				where,
				include: {
					user: { select: REVIEW_USER_SELECT },
					product: {
						select: { id: true, name: true, slug: true },
					},
				},
				orderBy: { [query.sortBy || 'createdAt']: query.sortOrder || 'desc' },
				skip,
				take: limit,
			}),
			this.prisma.review.count({ where }),
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
	// MODERER UN AVIS (ADMIN / STAFF)
	// ─────────────────────────────────────────────────────────────────────────

	async updateStatus(id: string, dto: UpdateReviewStatusDto) {
		const review = await this.prisma.review.findUnique({ where: { id } });
		if (!review) {
			throw new NotFoundException('Avis introuvable.');
		}

		return this.prisma.review.update({
			where: { id },
			data: { status: dto.status },
			include: {
				user: { select: REVIEW_USER_SELECT },
				product: { select: { id: true, name: true } },
			},
		});
	}

	// ─────────────────────────────────────────────────────────────────────────
	// SUPPRIMER UN AVIS (CLIENT OU ADMIN)
	// ─────────────────────────────────────────────────────────────────────────

	async remove(id: string, userId?: string, isAdmin = false) {
		const review = await this.prisma.review.findUnique({ where: { id } });
		if (!review) {
			throw new NotFoundException('Avis introuvable.');
		}

		if (!isAdmin && review.userId !== userId) {
			throw new ForbiddenException('Vous n\'avez pas le droit de supprimer cet avis.');
		}

		await this.prisma.review.delete({ where: { id } });
		return { message: 'Avis supprimé avec succès.' };
	}
}
