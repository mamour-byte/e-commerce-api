import { Test, TestingModule } from '@nestjs/testing';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';

describe('ShippingController', () => {
	let controller: ShippingController;

	const mockShippingService = {
		findAllZones: jest.fn(),
		createZone: jest.fn(),
		findZoneOne: jest.fn(),
		updateZone: jest.fn(),
		removeZone: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [ShippingController],
			providers: [
				{ provide: ShippingService, useValue: mockShippingService },
			],
		}).compile();

		controller = module.get<ShippingController>(ShippingController);
	});

	it('should be defined', () => {
		expect(controller).toBeDefined();
	});
});
