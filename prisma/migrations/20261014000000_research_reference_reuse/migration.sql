-- DropIndex
DROP INDEX IF EXISTS "ResearchItem_workspaceId_etsyListingId_key";

-- CreateIndex
CREATE INDEX "ResearchItem_workspaceId_etsyListingId_idx"
ON "ResearchItem"("workspaceId", "etsyListingId");

-- AlterTable
ALTER TABLE "ResearchItem"
ADD COLUMN "targetProduct" VARCHAR(100);
