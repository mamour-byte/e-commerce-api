-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('BROWSER', 'SERVER');

-- CreateEnum
CREATE TYPE "TrackingEventName" AS ENUM ('PAGE_VIEW', 'VIEW_CONTENT', 'ADD_TO_CART', 'ADD_TO_WISHLIST', 'INITIATE_CHECKOUT', 'ADD_PAYMENT_INFO', 'PURCHASE', 'SEARCH', 'LEAD', 'SUBSCRIBE');

-- CreateEnum
CREATE TYPE "TrafficPlatform" AS ENUM ('META', 'GOOGLE', 'TIKTOK', 'ORGANIC', 'DIRECT', 'REFERRAL', 'EMAIL', 'WHATSAPP', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TouchpointKind" AS ENUM ('FIRST_CLICK', 'LAST_CLICK', 'ASSISTED');

-- CreateEnum
CREATE TYPE "ConversionProvider" AS ENUM ('META_CAPI', 'GOOGLE_OFFLINE');

-- CreateEnum
CREATE TYPE "ConversionLogStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OrderCancelReason" AS ENUM ('CUSTOMER_REQUEST', 'OUT_OF_STOCK', 'DELIVERY_FAILED', 'COD_REFUSAL', 'DUPLICATE_ORDER', 'PAYMENT_FAILED', 'ADMIN', 'OTHER');

-- DropIndex
DROP INDEX "MarketingEvent_eventName_idx";

-- DropIndex
DROP INDEX "MarketingEvent_eventId_idx";

-- DropIndex
DROP INDEX "MarketingEvent_externalId_idx";

-- DropIndex
DROP INDEX "MarketingEvent_userId_idx";

-- DropIndex
DROP INDEX "MarketingEvent_sessionId_idx";

-- DropIndex
DROP INDEX "MarketingEvent_productId_idx";

-- DropIndex
DROP INDEX "MarketingEvent_campaign_idx";

-- DropIndex
DROP INDEX "MarketingEvent_createdAt_idx";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelReason" "OrderCancelReason",
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "firstTouchAt" TIMESTAMP(3),
ADD COLUMN     "firstTouchCampaign" TEXT,
ADD COLUMN     "firstTouchPlatform" "TrafficPlatform",
ADD COLUMN     "isCashOnDelivery" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastTouchCampaign" TEXT,
ADD COLUMN     "lastTouchPlatform" "TrafficPlatform",
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "sessionId" TEXT,
ADD COLUMN     "visitorId" TEXT;

-- MarketingEvent n'etait ecrit par aucune route : table vide par construction, purge avant ALTER NOT NULL
DELETE FROM "MarketingEvent";

-- AlterTable
ALTER TABLE "MarketingEvent" DROP COLUMN "campaign",
DROP COLUMN "content",
DROP COLUMN "eventName",
DROP COLUMN "externalId",
DROP COLUMN "fbc",
DROP COLUMN "fbclid",
DROP COLUMN "fbp",
DROP COLUMN "medium",
DROP COLUMN "metadata",
DROP COLUMN "term",
ADD COLUMN     "eventTime" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "name" "TrackingEventName" NOT NULL,
ADD COLUMN     "pagePath" TEXT,
ADD COLUMN     "pageUrl" TEXT,
ADD COLUMN     "quantity" INTEGER,
ADD COLUMN     "referrer" TEXT,
ADD COLUMN     "variantId" TEXT,
ADD COLUMN     "visitorId" TEXT,
ALTER COLUMN "eventId" SET NOT NULL,
ALTER COLUMN "currency" SET NOT NULL,
DROP COLUMN "source",
ADD COLUMN     "source" "EventSource" NOT NULL DEFAULT 'BROWSER';

-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "anonymousId" TEXT NOT NULL,
    "userId" TEXT,
    "emailHash" TEXT,
    "phoneHash" TEXT,
    "fbc" TEXT,
    "fbp" TEXT,
    "gaClientId" TEXT,
    "ttclid" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorSession" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "landingPage" TEXT NOT NULL,
    "pagePath" TEXT,
    "referrer" TEXT,
    "referrerDomain" TEXT,
    "userAgent" TEXT,
    "device" TEXT,
    "ipAddress" TEXT,
    "country" CHAR(2),
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "utmId" TEXT,
    "fbclid" TEXT,
    "gclid" TEXT,
    "gbraid" TEXT,
    "wbraid" TEXT,
    "ttclid" TEXT,
    "msclkid" TEXT,
    "clickId" TEXT,
    "clickIdType" TEXT,
    "platform" "TrafficPlatform" NOT NULL DEFAULT 'UNKNOWN',
    "campaignKey" TEXT,
    "consentGranted" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMP(3),

    CONSTRAINT "VisitorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorSessionEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" "TrackingEventName" NOT NULL,
    "pagePath" TEXT,
    "pageUrl" TEXT,
    "referrer" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitorSessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributionTouchpoint" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "visitorId" TEXT,
    "orderId" TEXT,
    "platform" "TrafficPlatform" NOT NULL,
    "campaignKey" TEXT,
    "adId" TEXT,
    "clickId" TEXT,
    "kind" "TouchpointKind" NOT NULL DEFAULT 'LAST_CLICK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionTouchpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversionLog" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "provider" "ConversionProvider" NOT NULL,
    "status" "ConversionLogStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "responseCode" INTEGER,
    "responseBody" TEXT,
    "sentAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCampaign" (
    "id" TEXT NOT NULL,
    "platform" "TrafficPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "utmCampaign" TEXT,
    "dailyBudget" DECIMAL(12,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdDailyStat" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "videoViews" INTEGER NOT NULL DEFAULT 0,
    "linkClicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchQuery" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalizedQuery" TEXT NOT NULL,
    "resultCount" INTEGER NOT NULL DEFAULT 0,
    "visitorId" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Visitor_anonymousId_key" ON "Visitor"("anonymousId");

-- CreateIndex
CREATE INDEX "Visitor_userId_idx" ON "Visitor"("userId");

-- CreateIndex
CREATE INDEX "Visitor_emailHash_idx" ON "Visitor"("emailHash");

-- CreateIndex
CREATE INDEX "Visitor_phoneHash_idx" ON "Visitor"("phoneHash");

-- CreateIndex
CREATE INDEX "Visitor_lastSeenAt_idx" ON "Visitor"("lastSeenAt");

-- CreateIndex
CREATE INDEX "VisitorSession_visitorId_startedAt_idx" ON "VisitorSession"("visitorId", "startedAt");

-- CreateIndex
CREATE INDEX "VisitorSession_clickId_idx" ON "VisitorSession"("clickId");

-- CreateIndex
CREATE INDEX "VisitorSession_platform_startedAt_idx" ON "VisitorSession"("platform", "startedAt");

-- CreateIndex
CREATE INDEX "VisitorSession_sessionKey_idx" ON "VisitorSession"("sessionKey");

-- CreateIndex
CREATE INDEX "VisitorSession_campaignKey_startedAt_idx" ON "VisitorSession"("campaignKey", "startedAt");

-- CreateIndex
CREATE INDEX "VisitorSession_startedAt_idx" ON "VisitorSession"("startedAt");

-- CreateIndex
CREATE INDEX "VisitorSessionEvent_sessionId_createdAt_idx" ON "VisitorSessionEvent"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "VisitorSessionEvent_name_createdAt_idx" ON "VisitorSessionEvent"("name", "createdAt");

-- CreateIndex
CREATE INDEX "AttributionTouchpoint_orderId_idx" ON "AttributionTouchpoint"("orderId");

-- CreateIndex
CREATE INDEX "AttributionTouchpoint_sessionId_idx" ON "AttributionTouchpoint"("sessionId");

-- CreateIndex
CREATE INDEX "AttributionTouchpoint_visitorId_idx" ON "AttributionTouchpoint"("visitorId");

-- CreateIndex
CREATE INDEX "AttributionTouchpoint_platform_createdAt_idx" ON "AttributionTouchpoint"("platform", "createdAt");

-- CreateIndex
CREATE INDEX "AttributionTouchpoint_campaignKey_createdAt_idx" ON "AttributionTouchpoint"("campaignKey", "createdAt");

-- CreateIndex
CREATE INDEX "AttributionTouchpoint_kind_createdAt_idx" ON "AttributionTouchpoint"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "ConversionLog_status_nextRetryAt_idx" ON "ConversionLog"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "ConversionLog_provider_createdAt_idx" ON "ConversionLog"("provider", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversionLog_eventId_provider_key" ON "ConversionLog"("eventId", "provider");

-- CreateIndex
CREATE INDEX "AdCampaign_utmCampaign_idx" ON "AdCampaign"("utmCampaign");

-- CreateIndex
CREATE INDEX "AdCampaign_platform_isActive_idx" ON "AdCampaign"("platform", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaign_platform_externalId_key" ON "AdCampaign"("platform", "externalId");

-- CreateIndex
CREATE INDEX "AdDailyStat_date_idx" ON "AdDailyStat"("date");

-- CreateIndex
CREATE UNIQUE INDEX "AdDailyStat_campaignId_date_key" ON "AdDailyStat"("campaignId", "date");

-- CreateIndex
CREATE INDEX "SearchQuery_normalizedQuery_idx" ON "SearchQuery"("normalizedQuery");

-- CreateIndex
CREATE INDEX "SearchQuery_createdAt_idx" ON "SearchQuery"("createdAt");

-- CreateIndex
CREATE INDEX "SearchQuery_sessionId_idx" ON "SearchQuery"("sessionId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx" ON "OrderStatusHistory"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_toStatus_createdAt_idx" ON "OrderStatusHistory"("toStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Order_visitorId_idx" ON "Order"("visitorId");

-- CreateIndex
CREATE INDEX "Order_sessionId_idx" ON "Order"("sessionId");

-- CreateIndex
CREATE INDEX "Order_lastTouchPlatform_createdAt_idx" ON "Order"("lastTouchPlatform", "createdAt");

-- CreateIndex
CREATE INDEX "Order_lastTouchCampaign_createdAt_idx" ON "Order"("lastTouchCampaign", "createdAt");

-- CreateIndex
CREATE INDEX "Order_firstTouchPlatform_createdAt_idx" ON "Order"("firstTouchPlatform", "createdAt");

-- CreateIndex
CREATE INDEX "Order_cancelReason_idx" ON "Order"("cancelReason");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingEvent_eventId_key" ON "MarketingEvent"("eventId");

-- CreateIndex
CREATE INDEX "MarketingEvent_visitorId_eventTime_idx" ON "MarketingEvent"("visitorId", "eventTime");

-- CreateIndex
CREATE INDEX "MarketingEvent_sessionId_eventTime_idx" ON "MarketingEvent"("sessionId", "eventTime");

-- CreateIndex
CREATE INDEX "MarketingEvent_name_eventTime_idx" ON "MarketingEvent"("name", "eventTime");

-- CreateIndex
CREATE INDEX "MarketingEvent_eventTime_idx" ON "MarketingEvent"("eventTime");

-- CreateIndex
CREATE INDEX "MarketingEvent_productId_eventTime_idx" ON "MarketingEvent"("productId", "eventTime");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorSession" ADD CONSTRAINT "VisitorSession_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorSessionEvent" ADD CONSTRAINT "VisitorSessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "MarketingEvent_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "MarketingEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "MarketingEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "MarketingEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "MarketingEvent_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingEvent" ADD CONSTRAINT "MarketingEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionTouchpoint" ADD CONSTRAINT "AttributionTouchpoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionTouchpoint" ADD CONSTRAINT "AttributionTouchpoint_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionTouchpoint" ADD CONSTRAINT "AttributionTouchpoint_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversionLog" ADD CONSTRAINT "ConversionLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "MarketingEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdDailyStat" ADD CONSTRAINT "AdDailyStat_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchQuery" ADD CONSTRAINT "SearchQuery_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchQuery" ADD CONSTRAINT "SearchQuery_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
