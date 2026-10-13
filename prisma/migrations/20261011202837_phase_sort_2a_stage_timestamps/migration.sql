-- AlterTable
ALTER TABLE "ResearchItem" ADD COLUMN     "correctionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "issueReportedAt" TIMESTAMP(3),
ADD COLUMN     "readyForListingAt" TIMESTAMP(3),
ADD COLUMN     "reviewSubmittedAt" TIMESTAMP(3);
