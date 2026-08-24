import { Test, TestingModule } from '@nestjs/testing';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

describe('ReviewsController', () => {
	let controller: ReviewsController;

	const mockReviewsService = {
		create: jest.fn(),
		findProductApprovedReviews: jest.fn(),
		findAllAdmin: jest.fn(),
		updateStatus: jest.fn(),
		remove: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [ReviewsController],
			providers: [
				{
					provide: ReviewsService,
					useValue: mockReviewsService,
				},
			],
		}).compile();

		controller = module.get<ReviewsController>(ReviewsController);
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});
});
