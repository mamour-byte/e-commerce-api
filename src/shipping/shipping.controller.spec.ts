import { Test, TestingModule } from '@nestjs/testing';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';

describe('ShippingController', () => {
	let controller: ShippingController;

	const mockShippingService = {
		createMethod: jest.fn(),
		findAllMethods: jest.fn(),
		findMethodOne: jest.fn(),
		updateMethod: jest.fn(),
		removeMethod: jest.fn(),
		findShipmentByOrder: jest.fn(),
		findShipmentByTrackingNumber: jest.fn(),
		updateShipmentStatus: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [ShippingController],
			providers: [
				{
					provide: ShippingService,
					useValue: mockShippingService,
				},
			],
		}).compile();

		controller = module.get<ShippingController>(ShippingController);
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});
});
