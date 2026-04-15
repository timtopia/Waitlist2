-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "SwapOffer" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SwapOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SwapOffer_lineId_idx" ON "SwapOffer"("lineId");

-- CreateIndex
CREATE INDEX "SwapOffer_toUserId_idx" ON "SwapOffer"("toUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SwapOffer_lineId_fromUserId_toUserId_key" ON "SwapOffer"("lineId", "fromUserId", "toUserId");
