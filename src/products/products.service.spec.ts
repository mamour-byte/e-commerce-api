import { ConflictException } from '@nestjs/common';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  let service: ProductsService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      product: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
    };

    service = new ProductsService(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should reject updating a product with a duplicate SKU', async () => {
    prisma.product.findFirst
      .mockResolvedValueOnce({ id: 'product-1' })
      .mockResolvedValueOnce({ id: 'product-2' });

    await expect(
      service.update('product-1', { sku: 'duplicate-sku' }),
    ).rejects.toThrow(ConflictException);

    expect(prisma.product.findFirst).toHaveBeenCalledTimes(2);
  });
});
