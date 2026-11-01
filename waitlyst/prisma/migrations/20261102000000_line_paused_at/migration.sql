-- When a line was paused, so called people get the paused time back on resume
ALTER TABLE "Line" ADD COLUMN "pausedAt" TIMESTAMP(3);
