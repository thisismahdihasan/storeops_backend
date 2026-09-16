-- Add edit timestamps for review message management.
ALTER TABLE "ReviewAnnotation" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "ReviewAnnotation" SET "updatedAt" = "createdAt";
ALTER TABLE "AnnotationReply" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "AnnotationReply" SET "updatedAt" = "createdAt";
