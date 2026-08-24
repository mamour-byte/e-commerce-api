import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { CartStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { CartContext } from './types/cart.types';

const CART_INCLUDE = {
	items: {
		include: {
			product: {
				select: {
					id: true,
					name: true,
					slug: true,
					status: true,
					stock: true,
					price: true,
					images: {
						where: { isPrimary: true },
						take: 1,
					},
				},
			},
			variant: {
				select: {
					id: true,
					sku: true,
					name: true,
					price: true,
					stock: true,
					isActive: true,
				},
			},
		},
		orderBy: { createdAt: 'asc' as const },
	},
} as const;

@Injectable()
export class CartService {
	constructor(private readonly prisma: PrismaService) {}

	// ─── Résoudre ou créer le panier actif ───────────────────────────────────

	async getOrCreate(ctx: CartContext) {
		const cart = await this.findActive(ctx);
		if (cart) return cart;

		return this.prisma.cart.create({
			data: {
				userId: ctx.userId,
				sessionId: ctx.sessionId,
				status: CartStatus.ACTIVE,
				expiresAt: ctx.userId
					? null
					: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
			},
			include: CART_INCLUDE,
		});
	}

	async get(ctx: CartContext) {
		const cart = await this.findActive(ctx);
		if (!cart) return { items: [], meta: { total: 0, itemCount: 0 } };
		return this.withMeta(cart);
	}

	// ─── Ajouter un article ───────────────────────────────────────────────────

	async addItem(ctx: CartContext, dto: AddCartItemDto) {
		// Lectures hors transaction (pas d'écriture)
		const product = await this.prisma.product.findFirst({
			where: { id: dto.productId, status: 'ACTIVE' },
		});
		if (!product) throw new NotFoundException('Produit introuvable ou inactif.');

		if (dto.variantId) {
			const variant = await this.prisma.productVariant.findFirst({
				where: { id: dto.variantId, productId: dto.productId, isActive: true },
			});
			if (!variant) throw new NotFoundException('Variante introuvable ou inactive.');
			const available = variant.stock - variant.reservedStock;
			if (dto.quantity > available)
				throw new BadRequestException(`Stock insuffisant. Disponible : ${available}`);
		} else {
			const available = product.stock - product.reservedStock;
			if (dto.quantity > available)
				throw new BadRequestException(`Stock insuffisant. Disponible : ${available}`);
		}

		const cart = await this.getOrCreate(ctx);

		const unitPrice = dto.variantId
			? ((await this.prisma.productVariant.findUnique({ where: { id: dto.variantId } }))?.price ?? product.price)
			: product.price;

		// Transaction atomique : findFirst + create/update
		await this.prisma.$transaction(async (tx) => {
			const existing = await tx.cartItem.findFirst({
				where: {
					cartId: cart.id,
					productId: dto.productId,
					variantId: dto.variantId ?? null,
				},
			});

			if (existing) {
				await tx.cartItem.update({
					where: { id: existing.id },
					data: { quantity: existing.quantity + dto.quantity },
				});
			} else {
				await tx.cartItem.create({
					data: {
						cartId: cart.id,
						productId: dto.productId,
						variantId: dto.variantId,
						quantity: dto.quantity,
						unitPrice,
					},
				});
			}
		});

		return this.withMeta(await this.findActiveById(cart.id));
	}

	// ─── Mettre à jour la quantité ────────────────────────────────────────────

	async updateItem(ctx: CartContext, itemId: string, dto: UpdateCartItemDto) {
		const item = await this.resolveItem(ctx, itemId);

		// Transaction atomique : vérif stock + update
		await this.prisma.$transaction(async (tx) => {
			const source = item.variantId
				? await tx.productVariant.findUnique({ where: { id: item.variantId } })
				: await tx.product.findUnique({ where: { id: item.productId } });

			if (source) {
				const available = source.stock - source.reservedStock;
				if (dto.quantity > available)
					throw new BadRequestException(`Stock insuffisant. Disponible : ${available}`);
			}

			await tx.cartItem.update({
				where: { id: item.id },
				data: { quantity: dto.quantity },
			});
		});

		return this.withMeta(await this.findActiveById(item.cartId));
	}

	// ─── Supprimer un article ─────────────────────────────────────────────────

	async removeItem(ctx: CartContext, itemId: string) {
		const item = await this.resolveItem(ctx, itemId);
		await this.prisma.cartItem.delete({ where: { id: item.id } });
		return this.withMeta(await this.findActiveById(item.cartId));
	}

	// ─── Vider le panier ──────────────────────────────────────────────────────

	async clear(ctx: CartContext) {
		const cart = await this.findActive(ctx);
		if (!cart) return { items: [], meta: { total: 0, itemCount: 0 } };
		await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
		return this.withMeta(await this.findActiveById(cart.id));
	}

	// ─── Fusionner panier guest → utilisateur connecté ───────────────────────

	async merge(userId: string, sessionId: string) {
		const guestCart = await this.prisma.cart.findFirst({
			where: { sessionId, status: CartStatus.ACTIVE },
			include: { items: true },
		});

		if (!guestCart || guestCart.items.length === 0)
			return this.get({ userId });

		const userCart = await this.getOrCreate({ userId });

		// Transaction atomique : tous les upserts + conversion du panier guest
		await this.prisma.$transaction(async (tx) => {
			for (const guestItem of guestCart.items) {
				const existing = await tx.cartItem.findFirst({
					where: {
						cartId: userCart.id,
						productId: guestItem.productId,
						variantId: guestItem.variantId ?? null,
					},
				});

				if (existing) {
					await tx.cartItem.update({
						where: { id: existing.id },
						data: { quantity: existing.quantity + guestItem.quantity },
					});
				} else {
					await tx.cartItem.create({
						data: {
							cartId: userCart.id,
							productId: guestItem.productId,
							variantId: guestItem.variantId,
							quantity: guestItem.quantity,
							unitPrice: guestItem.unitPrice,
						},
					});
				}
			}

			await tx.cart.update({
				where: { id: guestCart.id },
				data: { status: CartStatus.CONVERTED },
			});
		});

		return this.withMeta(await this.findActiveById(userCart.id));
	}

	// ─── Helpers privés ───────────────────────────────────────────────────────

	private async findActive(ctx: CartContext) {
		if (!ctx.userId && !ctx.sessionId) return null;

		return this.prisma.cart.findFirst({
			where: {
				status: CartStatus.ACTIVE,
				...(ctx.userId
					? { userId: ctx.userId }
					: { sessionId: ctx.sessionId }),
			},
			include: CART_INCLUDE,
		});
	}

	private async findActiveById(cartId: string) {
		return this.prisma.cart.findUniqueOrThrow({
			where: { id: cartId },
			include: CART_INCLUDE,
		});
	}

	private async resolveItem(ctx: CartContext, itemId: string) {
		const cart = await this.findActive(ctx);
		if (!cart) throw new NotFoundException('Panier introuvable.');

		const item = await this.prisma.cartItem.findFirst({
			where: { id: itemId, cartId: cart.id },
		});
		if (!item) throw new NotFoundException('Article introuvable dans le panier.');
		return item;
	}

	private withMeta(cart: Awaited<ReturnType<typeof this.findActiveById>>) {
		const itemCount = cart.items.reduce((sum, i) => sum + i.quantity, 0);
		const total = cart.items.reduce(
			(sum, i) => sum + Number(i.unitPrice) * i.quantity,
			0,
		);
		return { ...cart, meta: { itemCount, total: Math.round(total * 100) / 100 } };
	}
}
