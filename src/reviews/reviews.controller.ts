import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Param,
	Patch,
	Post,
	Query,
	UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReviewQueryDto } from './dto/review-query.dto';
import { UpdateReviewStatusDto } from './dto/update-review-status.dto';
import { ReviewsService } from './reviews.service';

type AuthUser = { id: string; role: UserRole };

@Controller('reviews')
export class ReviewsController {
	constructor(private readonly reviewsService: ReviewsService) {}

	/**
	 * Client connecté : Déposer un avis et une note sur un produit
	 */
	@Post()
	@UseGuards(JwtAuthGuard)
	create(
		@Body() dto: CreateReviewDto,
		@CurrentUser() user: AuthUser,
	) {
		return this.reviewsService.create(user.id, dto);
	}

	/**
	 * Public : Consulter la liste des avis approuvés et la note moyenne d'un produit
	 */
	@Get('product/:productId')
	findProductApprovedReviews(
		@Param('productId') productId: string,
		@Query('page') page?: number,
		@Query('limit') limit?: number,
	) {
		return this.reviewsService.findProductApprovedReviews(productId, page, limit);
	}

	/**
	 * Admin / Staff : Consulter tous les avis pour modération (filtres par statut et note)
	 */
	@Get()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	findAllAdmin(@Query() query: ReviewQueryDto) {
		return this.reviewsService.findAllAdmin(query);
	}

	/**
	 * Admin / Staff : Modérer un avis (APPROVED / REJECTED)
	 */
	@Patch(':id/status')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles(UserRole.ADMIN, UserRole.STAFF)
	updateStatus(
		@Param('id') id: string,
		@Body() dto: UpdateReviewStatusDto,
	) {
		return this.reviewsService.updateStatus(id, dto);
	}

	/**
	 * Client (son propre avis) ou Admin : Supprimer un avis
	 */
	@Delete(':id')
	@HttpCode(HttpStatus.OK)
	@UseGuards(JwtAuthGuard)
	remove(
		@Param('id') id: string,
		@CurrentUser() user: AuthUser,
	) {
		return this.reviewsService.remove(id, user.id, user.role === UserRole.ADMIN);
	}
}
