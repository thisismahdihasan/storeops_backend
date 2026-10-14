CREATE TYPE "ReferenceImageStorageProvider" AS ENUM ('CLOUDINARY', 'R2');

ALTER TABLE "ResearchItem"
ADD COLUMN "referenceImageStorageKey" TEXT,
ADD COLUMN "referenceImageStorageProvider" "ReferenceImageStorageProvider" NOT NULL DEFAULT 'CLOUDINARY';
