-- AlterTable
ALTER TABLE "Line" ADD COLUMN     "hideCapacity" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nowServing" TEXT,
ADD COLUMN     "nowServingAt" TIMESTAMP(3);
