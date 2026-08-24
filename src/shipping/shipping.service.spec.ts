import { Test, TestingModule } from '@nestjs/testing';
import { ShippingService } from './shipping.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ShippingService', () => {
	let service: ShippingService;

	const mockPrismaService = {
		shippingMethod: {
			create: jest.fn(),
			findMany: jest.fn(),
			findUnique: jest.fn(),
			update: jest.fn(),
			delete: jest.fn(),
		},
		shipment: {
			findFirst: jest.fn(),
			update: jest.fn(),
		},
		order: {
			update: jest.fn(),
		},
		$transaction: jest.fn((cb) => cb(mockPrismaService)),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ShippingService,
				{ provide: PrismaService, useValue: mockPrismaService },
			],
		}).compile();

		service = module.get<ShippingService>(ShippingService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});
});
