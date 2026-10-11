-- AlterTable
ALTER TABLE "ResearchItem" ADD COLUMN     "correctionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "issueReportedAt" TIMESTAMP(3),
ADD COLUMN     "readyForListingAt" TIMESTAMP(3),
ADD COLUMN     "reviewSubmittedAt" TIMESTAMP(3);

UPDATE "ResearchItem" AS r
SET "readyForListingAt" = sub.max_completed
FROM (
  SELECT "researchItemId", MAX("completedAt") AS max_completed
  FROM "DesignAssignment"
  WHERE "completedAt" IS NOT NULL
  GROUP BY "researchItemId"
) AS sub
WHERE r.id = sub."researchItemId";
