-- AlterTable
ALTER TABLE "FinalAsset" ADD COLUMN     "storageDeletedAt" TIMESTAMP(3),
ADD COLUMN     "storageDeletedById" TEXT;

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "finalAssetAutoCleanupEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "finalAssetRetentionDays" INTEGER NOT NULL DEFAULT 30;

-- CreateIndex
CREATE INDEX "FinalAsset_storageDeletedAt_idx" ON "FinalAsset"("storageDeletedAt");

-- AddForeignKey
ALTER TABLE "FinalAsset" ADD CONSTRAINT "FinalAsset_storageDeletedById_fkey" FOREIGN KEY ("storageDeletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
