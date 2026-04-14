-- AlterTable
ALTER TABLE "Line" ADD COLUMN     "allowResale" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxAskingPrice" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "stripeConnectId" TEXT,
ADD COLUMN     "stripeConnectOnboarded" BOOLEAN NOT NULL DEFAULT false;
