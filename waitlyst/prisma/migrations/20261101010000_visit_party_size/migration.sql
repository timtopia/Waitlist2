-- Party size on finished visits, for wait-by-party-size analytics
ALTER TABLE "QueueVisit" ADD COLUMN "partySize" INTEGER NOT NULL DEFAULT 1;
