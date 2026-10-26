-- Cycle de vie des paiements : expiration, reconciliation et abandon.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE "Payment"
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "nextReconciliationAt" TIMESTAMP(3);

CREATE INDEX "Payment_status_nextReconciliationAt_idx"
  ON "Payment"("status", "nextReconciliationAt");

-- Reprise des paiements en attente existants : fenetre de 15 minutes.
UPDATE "Payment"
SET
  "expiresAt" = "createdAt" + INTERVAL '15 minutes',
  "nextReconciliationAt" = LEAST(
    now(),
    "createdAt" + INTERVAL '15 minutes'
  )
WHERE "status" IN ('PENDING', 'PROCESSING')
  AND "provider" <> 'CASH_ON_DELIVERY';
