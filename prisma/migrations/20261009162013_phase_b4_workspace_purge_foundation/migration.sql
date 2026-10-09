-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "purgeStartedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Workspace_deletionScheduledAt_idx" ON "Workspace"("deletionScheduledAt");
