-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "stripePaymentIntentId" TEXT;

-- CreateIndex
CREATE INDEX "Transaction_stripePaymentIntentId_idx" ON "Transaction"("stripePaymentIntentId");
