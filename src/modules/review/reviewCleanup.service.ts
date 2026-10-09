import { getCloudinaryClient } from "../../config/cloudinary.js";
import prisma from "../../lib/prisma.js";

export type ReviewImageDestroyResult = "ok" | "not_found";

export type ReviewImageDestroyer = (
  publicId: string
) => Promise<ReviewImageDestroyResult>;

export type ReviewImageCleanupOptions = {
  now?: Date;
  cutoffDays?: number;
  batchSize?: number;
  destroyImage?: ReviewImageDestroyer;
};

export type ReviewImageCleanupResult = {
  status: "completed" | "already_running";
  scanned: number;
  eligible: number;
  deleted: number;
  alreadyMissing: number;
  failed: number;
  failedIds: string[];
  cutoffDate: string;
};

// PostgreSQL 64-bit advisory lock key dedicated to review image cleanup
const REVIEW_IMAGE_CLEANUP_LOCK_ID = 837261948;

// In-process lock guard to prevent overlapping execution within the same Node process
let isCleanupInProgress = false;

// Default production destroyer that calls Cloudinary SDK
export const destroyCloudinaryImage: ReviewImageDestroyer = async (
  publicId: string
): Promise<ReviewImageDestroyResult> => {
  const client = getCloudinaryClient();
  const result = await client.uploader.destroy(publicId, {
    resource_type: "image",
  });

  if (result.result === "ok") {
    return "ok";
  }

  if (result.result === "not found" || result.result === "not_found") {
    return "not_found";
  }

  throw new Error(
    `Cloudinary destroy returned unexpected result: ${String(result.result)}`
  );
};

// Cleans up old non-approved review screenshots stored in Cloudinary
export const cleanupOldReviewImages = async (
  options?: ReviewImageCleanupOptions
): Promise<ReviewImageCleanupResult> => {
  const now = options?.now ?? new Date();
  const cutoffDays = options?.cutoffDays ?? 30;
  const cutoffDate = new Date(now.getTime() - cutoffDays * 24 * 60 * 60 * 1000);
  const batchSize = options?.batchSize ?? 50;
  const destroyer = options?.destroyImage ?? destroyCloudinaryImage;

  // 1. In-process check: guard against overlapping runs in the same Node event loop
  if (isCleanupInProgress) {
    return {
      status: "already_running",
      scanned: 0,
      eligible: 0,
      deleted: 0,
      alreadyMissing: 0,
      failed: 0,
      failedIds: [],
      cutoffDate: cutoffDate.toISOString(),
    };
  }

  isCleanupInProgress = true;

  try {
    // 2. Cross-process / connection-safe advisory lock via interactive transaction
    return await prisma.$transaction(
      async (tx) => {
        const lockRows = await tx.$queryRaw<[{ acquired: boolean }]>`
          SELECT pg_try_advisory_xact_lock(${REVIEW_IMAGE_CLEANUP_LOCK_ID}) AS acquired;
        `;
        const acquired = lockRows[0]?.acquired ?? false;

        if (!acquired) {
          return {
            status: "already_running",
            scanned: 0,
            eligible: 0,
            deleted: 0,
            alreadyMissing: 0,
            failed: 0,
            failedIds: [],
            cutoffDate: cutoffDate.toISOString(),
          };
        }

        // 3. Candidate query: bounded findMany with strict eligibility criteria
        // - imageDeletedAt IS NULL
        // - THIS review submission is NOT approved (approvedAt IS NULL)
        // - Parent ResearchItem has an approved review submission where approvedAt <= cutoffDate
        const candidates = await tx.reviewSubmission.findMany({
          where: {
            imageDeletedAt: null,
            approvedAt: null,
            researchItem: {
              reviewSubmissions: {
                some: {
                  approvedAt: {
                    lte: cutoffDate,
                  },
                },
              },
            },
          },
          select: {
            id: true,
            imagePublicId: true,
            researchItemId: true,
            roundNumber: true,
          },
          orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
          take: batchSize,
        });

        let deleted = 0;
        let alreadyMissing = 0;
        let failed = 0;
        const failedIds: string[] = [];

        // 4. Sequential processing with failure isolation
        for (const candidate of candidates) {
          try {
            // Step 1: External delete from Cloudinary
            const destroyResult = await destroyer(candidate.imagePublicId);

            // Step 2: If external delete is "ok" or "not_found", conditionally update DB
            if (destroyResult === "ok" || destroyResult === "not_found") {
              const updateResult = await tx.reviewSubmission.updateMany({
                where: {
                  id: candidate.id,
                  imageDeletedAt: null,
                },
                data: {
                  imageDeletedAt: now,
                },
              });

              if (updateResult.count > 0) {
                if (destroyResult === "ok") {
                  deleted += 1;
                } else {
                  alreadyMissing += 1;
                }
              } else {
                // Already marked by another concurrent process / retry
                alreadyMissing += 1;
              }
            } else {
              failed += 1;
              failedIds.push(candidate.id);
            }
          } catch (_error) {
            // Step 3: On provider failure, leave DB row unchanged and record failure
            failed += 1;
            failedIds.push(candidate.id);
          }
        }

        return {
          status: "completed",
          scanned: candidates.length,
          eligible: candidates.length,
          deleted,
          alreadyMissing,
          failed,
          failedIds,
          cutoffDate: cutoffDate.toISOString(),
        };
      },
      {
        maxWait: 5000,
        timeout: 60000,
      }
    );
  } finally {
    isCleanupInProgress = false;
  }
};
