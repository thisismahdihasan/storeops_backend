-- Retroactive reconciliation migration.
-- Records ReviewSubmission objects that were applied to the database out-of-band
-- via `prisma db push` (schema commits 5b1aa28, 66d49b1) but never captured in
-- migration history. The live database already contains every object below;
-- this migration is to be marked applied via `prisma migrate resolve` without
-- execution against that database.

-- AlterTable
ALTER TABLE "ReviewSubmission" ADD COLUMN "note" TEXT,
    ADD COLUMN "approvedAt" TIMESTAMP(3),
    ADD COLUMN "approvedById" TEXT,
    ADD COLUMN "imageDeletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ReviewSubmission_approvedById_idx" ON "ReviewSubmission"("approvedById");

-- CreateIndex
CREATE INDEX "ReviewSubmission_imageDeletedAt_idx" ON "ReviewSubmission"("imageDeletedAt");

-- AddForeignKey
ALTER TABLE "ReviewSubmission" ADD CONSTRAINT "ReviewSubmission_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
