-- AlterTable
ALTER TABLE "Product" ADD COLUMN "trackInventory" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "trackInventory" BOOLEAN NOT NULL DEFAULT true;
