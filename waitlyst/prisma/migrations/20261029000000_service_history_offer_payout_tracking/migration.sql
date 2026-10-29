-- CreateEnum
CREATE TYPE "VisitOutcome" AS ENUM ('SERVED', 'LEFT', 'REMOVED');

-- AlterEnum (Postgres 12+ allows several ADD VALUEs in one transaction)
ALTER TYPE "OfferStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "OfferStatus" ADD VALUE 'WITHDRAWN';

-- AlterTable
ALTER TABLE "Line" ADD COLUMN     "nowServingUserId" TEXT;

-- AlterTable
ALTER TABLE "LinePosition" ADD COLUMN     "calledAt" TIMESTAMP(3);

-- AlterTable
-- Existing offers get the 24h lifetime the app used to derive from createdAt.
ALTER TABLE "SwapOffer" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "transactionId" TEXT;
UPDATE "SwapOffer" SET "expiresAt" = "createdAt" + INTERVAL '24 hours';
ALTER TABLE "SwapOffer" ALTER COLUMN "expiresAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "capturedAt" TIMESTAMP(3),
ADD COLUMN     "ownerPaidAt" TIMESTAMP(3),
ADD COLUMN     "sellerPaidAt" TIMESTAMP(3);
-- Before this migration a settled COMPLETED purchase meant "captured", and
-- payees who had finished payout setup were paid at that point (or by the
-- one-time catch-up when they onboarded). Payees who still haven't onboarded
-- are left unpaid so their catch-up runs when they do.
UPDATE "Transaction" SET "capturedAt" = "settledAt"
WHERE "status" = 'COMPLETED' AND "settledAt" IS NOT NULL;

UPDATE "Transaction" t SET "sellerPaidAt" = t."settledAt"
FROM "User" u
WHERE u."id" = t."sellerId" AND u."stripeConnectOnboarded" = true
  AND t."status" = 'COMPLETED' AND t."settledAt" IS NOT NULL;

UPDATE "Transaction" t SET "ownerPaidAt" = t."settledAt"
WHERE t."status" = 'COMPLETED' AND t."settledAt" IS NOT NULL
  AND (t."ownerFee" = 0 OR EXISTS (
    SELECT 1 FROM "Line" l JOIN "User" u ON u."id" = l."createdById"
    WHERE l."id" = t."lineId" AND u."stripeConnectOnboarded" = true
  ));

-- CreateTable
CREATE TABLE "QueueVisit" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcome" "VisitOutcome" NOT NULL,
    "position" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "calledAt" TIMESTAMP(3),
    "servedAt" TIMESTAMP(3),
    "exitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueueVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QueueVisit_lineId_servedAt_idx" ON "QueueVisit"("lineId", "servedAt");

-- CreateIndex
CREATE INDEX "QueueVisit_userId_idx" ON "QueueVisit"("userId");

-- AddForeignKey
ALTER TABLE "QueueVisit" ADD CONSTRAINT "QueueVisit_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueVisit" ADD CONSTRAINT "QueueVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

