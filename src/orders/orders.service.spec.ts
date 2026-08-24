import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

describe('OrdersService', () => {
	let service: OrdersService;

	const mockPrismaService = {
		order: {
			create: jest.fn(),
			findMany: jest.fn(),
			findFirst: jest.fn(),
			findUnique: jest.fn(),
			update: jest.fn(),
			count: jest.fn(),
		},
		product: {
			findFirst: jest.fn(),
			update: jest.fn(),
		},
		productVariant: {
			findFirst: jest.fn(),
			update: jest.fn(),
		},
		cart: {
			findFirst: jest.fn(),
			update: jest.fn(),
		},
		coupon: {
			findFirst: jest.fn(),
			update: jest.fn(),
		},
		$transaction: jest.fn((callback) => callback(mockPrismaService)),
	};

	const mockMailService = {
		sendOrderReceipt: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				OrdersService,
				{
					provide: PrismaService,
					useValue: mockPrismaService,
				},
				{
					provide: MailService,
					useValue: mockMailService,
				},
			],
		}).compile();

		service = module.get<OrdersService>(OrdersService);
	});

	it('should be defined', () => {
		expect(service).toBeDefined();
	});
});
