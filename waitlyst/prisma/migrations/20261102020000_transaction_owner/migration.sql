-- Who earns the owner fee, kept on the sale so it survives the line being deleted
ALTER TABLE "Transaction" ADD COLUMN "ownerId" TEXT;
UPDATE "Transaction" t SET "ownerId" = l."createdById" FROM "Line" l WHERE l."id" = t."lineId";
CREATE INDEX "Transaction_ownerId_idx" ON "Transaction"("ownerId");

-- Extra minutes the host gave a called party to show up; reset on each new call
ALTER TABLE "LinePosition" ADD COLUMN "graceMinutes" INTEGER NOT NULL DEFAULT 0;
