-- AlterTable Product : remplacer stock/reservedStock/lowStockThreshold par quantity
ALTER TABLE "Product" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 0;
UPDATE "Product" SET "quantity" = "stock" WHERE "stock" IS NOT NULL;
ALTER TABLE "Product" DROP COLUMN "stock";
ALTER TABLE "Product" DROP COLUMN "reservedStock";
ALTER TABLE "Product" DROP COLUMN "lowStockThreshold";

-- AlterTable ProductVariant : remplacer stock/reservedStock par quantity
ALTER TABLE "ProductVariant" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 0;
UPDATE "ProductVariant" SET "quantity" = "stock" WHERE "stock" IS NOT NULL;
ALTER TABLE "ProductVariant" DROP COLUMN "stock";
ALTER TABLE "ProductVariant" DROP COLUMN "reservedStock";
