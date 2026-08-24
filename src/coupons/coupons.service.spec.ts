import { Test, TestingModule } from '@nestjs/testing';
import { CouponsService } from './coupons.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CouponsService', () => {
	let service: CouponsService;

	const mockPrismaService = {
		coupon: {
			create: jest.fn(),
			findMany: jest.fn(),
			findFirst: jest.fn(),
			findUnique: jest.fn(),
			update: jest.fn(),
			delete: jest.fn(),
			count: jest.fn(),
		},
		couponUsage: {
			findMany: jest.fn(),
			count: jest.fn(),
		},
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CouponsService,
				{ provide: PrismaService, useValue: mockPrismaService },
			],
		}).compile();

		service = module.get<CouponsService>(CouponsService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});
});
