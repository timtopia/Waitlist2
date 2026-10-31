-- CreateEnum
CREATE TYPE "CallResponse" AS ENUM ('ON_MY_WAY', 'RUNNING_LATE');

-- AlterTable
ALTER TABLE "Line" ADD COLUMN "purchaseLimit" INTEGER;
ALTER TABLE "Line" ADD COLUMN "responseWindowMinutes" INTEGER;

-- AlterTable
ALTER TABLE "LinePosition" ADD COLUMN "response" "CallResponse";
ALTER TABLE "LinePosition" ADD COLUMN "respondedAt" TIMESTAMP(3);
