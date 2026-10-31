-- CreateTable
CREATE TABLE "LineReminder" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "LineReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LineReminder_sentAt_idx" ON "LineReminder"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "LineReminder_lineId_userId_key" ON "LineReminder"("lineId", "userId");

-- AddForeignKey
ALTER TABLE "LineReminder" ADD CONSTRAINT "LineReminder_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "Line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineReminder" ADD CONSTRAINT "LineReminder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
