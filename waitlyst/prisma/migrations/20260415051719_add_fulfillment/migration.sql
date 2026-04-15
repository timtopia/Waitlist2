-- AlterTable
ALTER TABLE "LinePosition" ADD COLUMN     "fulfilled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fulfilledAt" TIMESTAMP(3);
