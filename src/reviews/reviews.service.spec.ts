import { Test, TestingModule } from '@nestjs/testing';
import { ReviewsService } from './reviews.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ReviewsService', () => {
	let service: ReviewsService;

	const mockPrismaService = {
		review: {
			create: jest.fn(),
			findMany: jest.fn(),
			findFirst: jest.fn(),
			findUnique: jest.fn(),
			update: jest.fn(),
			delete: jest.fn(),
			count: jest.fn(),
			aggregate: jest.fn(),
			groupBy: jest.fn(),
		},
		product: {
			findUnique: jest.fn(),
		},
		order: {
			findFirst: jest.fn(),
		},
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ReviewsService,
				{ provide: PrismaService, useValue: mockPrismaService },
			],
		}).compile();

		service = module.get<ReviewsService>(ReviewsService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});
});
