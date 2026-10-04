-- AlterTable
ALTER TABLE "MarketingEvent" ADD COLUMN     "searchQuery" TEXT;

-- CreateIndex
CREATE INDEX "MarketingEvent_name_productId_eventTime_idx" ON "MarketingEvent"("name", "productId", "eventTime");
