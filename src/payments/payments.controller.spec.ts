import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController', () => {
  let controller: PaymentsController;

  const mockPaymentsService = {
    initiatePayment: jest.fn(),
    findByOrder: jest.fn(),
    findOne: jest.fn(),
    handleWaveWebhook: jest.fn(),
    handleOrangeMoneyWebhook: jest.fn(),
    buildCheckoutRedirectTarget: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        {
          provide: PaymentsService,
          useValue: mockPaymentsService,
        },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('redirectToCheckout', () => {
    it('renvoie une 302 vers la page de retour du front', () => {
      const res = { redirect: jest.fn() };
      mockPaymentsService.buildCheckoutRedirectTarget.mockReturnValue(
        'http://localhost:5173/checkout/success?orderId=order_1&orderNumber=ORD-1',
      );

      controller.redirectToCheckout(
        'success',
        'order_1',
        'ORD-1',
        res as never,
      );

      expect(
        mockPaymentsService.buildCheckoutRedirectTarget,
      ).toHaveBeenCalledWith('success', {
        orderId: 'order_1',
        orderNumber: 'ORD-1',
      });
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        'http://localhost:5173/checkout/success?orderId=order_1&orderNumber=ORD-1',
      );
    });
  });
});
