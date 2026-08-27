-- CreateEnum
CREATE TYPE "FulfillmentType" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateTable
CREATE TABLE "DeliveryZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "fulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'PICKUP';
ALTER TABLE "Order" ADD COLUMN "deliveryZoneId" TEXT;

-- Drop legacy shipping tables (no tracking needed)
ALTER TABLE "Shipment" DROP CONSTRAINT IF EXISTS "Shipment_orderId_fkey";
DROP TABLE IF EXISTS "Shipment";
DROP TABLE IF EXISTS "ShippingMethod";
DROP TYPE IF EXISTS "ShipmentStatus";

-- Simplify order statuses: PROCESSING/SHIPPED -> IN_DELIVERY
CREATE TYPE "OrderStatus_new" AS ENUM ('PENDING', 'CONFIRMED', 'IN_DELIVERY', 'DELIVERED', 'CANCELLED', 'REFUNDED');

ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_new" USING (
    CASE "status"::text
        WHEN 'PROCESSING' THEN 'IN_DELIVERY'
        WHEN 'SHIPPED' THEN 'IN_DELIVERY'
        ELSE "status"::text
    END
)::"OrderStatus_new";

DROP TYPE "OrderStatus";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- Remove unused billing address
ALTER TABLE "Order" DROP COLUMN IF EXISTS "billingAddress";

-- CreateIndex
CREATE INDEX "Order_fulfillmentType_idx" ON "Order"("fulfillmentType");
CREATE INDEX "Order_deliveryZoneId_idx" ON "Order"("deliveryZoneId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryZoneId_fkey" FOREIGN KEY ("deliveryZoneId") REFERENCES "DeliveryZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
