-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "captureBefore" TIMESTAMP(3),
ADD COLUMN     "holdExpiredAt" TIMESTAMP(3);
