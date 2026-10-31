-- Walk-ins added by the host have no account
ALTER TABLE "User" ADD COLUMN "isWalkIn" BOOLEAN NOT NULL DEFAULT false;

-- Party notes and host-quoted waits
ALTER TABLE "LinePosition" ADD COLUMN "note" TEXT;
ALTER TABLE "LinePosition" ADD COLUMN "quotedMinutes" INTEGER;
ALTER TABLE "LinePosition" ADD COLUMN "quotedAt" TIMESTAMP(3);

-- No-shows recorded separately from other removals
ALTER TYPE "VisitOutcome" ADD VALUE 'NO_SHOW';
