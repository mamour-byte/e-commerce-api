-- CreateTable
CREATE TABLE "DeliveryNeighborhood" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deliveryZoneId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryNeighborhood_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "deliveryNeighborhoodId" TEXT;

-- CreateIndex
CREATE INDEX "DeliveryNeighborhood_deliveryZoneId_idx" ON "DeliveryNeighborhood"("deliveryZoneId");
CREATE INDEX "DeliveryNeighborhood_name_idx" ON "DeliveryNeighborhood"("name");

-- CreateIndex
CREATE INDEX "Order_deliveryNeighborhoodId_idx" ON "Order"("deliveryNeighborhoodId");

-- AddForeignKey
ALTER TABLE "DeliveryNeighborhood" ADD CONSTRAINT "DeliveryNeighborhood_deliveryZoneId_fkey" FOREIGN KEY ("deliveryZoneId") REFERENCES "DeliveryZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryNeighborhoodId_fkey" FOREIGN KEY ("deliveryNeighborhoodId") REFERENCES "DeliveryNeighborhood"("id") ON DELETE SET NULL ON UPDATE CASCADE;
