import { Test, TestingModule } from '@nestjs/testing';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

describe('OrdersController', () => {
	let controller: OrdersController;

	const mockOrdersService = {
		create: jest.fn(),
		findMyOrders: jest.fn(),
		findMyOrderById: jest.fn(),
		cancelMyOrder: jest.fn(),
		findAll: jest.fn(),
		findOne: jest.fn(),
		updateStatus: jest.fn(),
		updatePaymentStatus: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [OrdersController],
			providers: [
				{
					provide: OrdersService,
					useValue: mockOrdersService,
				},
			],
		}).compile();

		controller = module.get<OrdersController>(OrdersController);
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});
});
