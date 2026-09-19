import { ResearchStatus } from "@prisma/client";

import prisma from "../../lib/prisma.js";
import { deleteObjectsBatch, DeleteObjectsBatchResult } from "../storage/r2.js";

export type FinalAssetBatchDeleter = (
  storageKeys: string[]
) => Promise<DeleteObjectsBatchResult>;

export type FinalAssetAutoCleanupOptions = {
  now?: Date;
  batchSize?: number;
  maxBatchesPerWorkspace?: number;
  deleteBatch?: FinalAssetBatchDeleter;
};

export type FinalAssetAutoCleanupResult = {
  status: "completed" | "already_running";
  workspacesChecked: number;
  workspacesProcessed: number;
  eligibleCount: number;
  cleanedCount: number;
  alreadyCleanedCount: number;
  failedCount: number;
  reclaimedBytes: string;
};

// PostgreSQL 64-bit advisory lock key dedicated to final asset storage cleanup
const FINAL_ASSET_AUTO_CLEANUP_LOCK_ID = 837261950;

// In-process lock guard to prevent overlapping execution within the same Node process
let isAutoCleanupInProgress = false;

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_BATCHES_PER_WORKSPACE = 10;

export const runFinalAssetAutoCleanup = async (
  options?: FinalAssetAutoCleanupOptions
): Promise<FinalAssetAutoCleanupResult> => {
  const now = options?.now ?? new Date();
  const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatchesPerWorkspace =
    options?.maxBatchesPerWorkspace ?? DEFAULT_MAX_BATCHES_PER_WORKSPACE;
  const deleteBatch = options?.deleteBatch ?? deleteObjectsBatch;

  // 1. In-process check: guard against overlapping runs in the same Node event loop
  if (isAutoCleanupInProgress) {
    return {
      status: "already_running",
      workspacesChecked: 0,
      workspacesProcessed: 0,
      eligibleCount: 0,
      cleanedCount: 0,
      alreadyCleanedCount: 0,
      failedCount: 0,
      reclaimedBytes: "0",
    };
  }

  isAutoCleanupInProgress = true;

  try {
    // 2. Cross-process / connection-safe advisory lock via interactive transaction
    return await prisma.$transaction(
      async (tx) => {
        const lockRows = await tx.$queryRaw<[{ acquired: boolean }]>`
          SELECT pg_try_advisory_xact_lock(${FINAL_ASSET_AUTO_CLEANUP_LOCK_ID}) AS acquired;
        `;
        const acquired = lockRows[0]?.acquired ?? false;

        if (!acquired) {
          return {
            status: "already_running",
            workspacesChecked: 0,
            workspacesProcessed: 0,
            eligibleCount: 0,
            cleanedCount: 0,
            alreadyCleanedCount: 0,
            failedCount: 0,
            reclaimedBytes: "0",
          };
        }

        // 3. Query all workspaces with auto-cleanup enabled
        const enabledWorkspaces = await tx.workspace.findMany({
          where: {
            finalAssetAutoCleanupEnabled: true,
          },
          select: {
            id: true,
            finalAssetRetentionDays: true,
          },
          orderBy: { id: "asc" },
        });

        let workspacesProcessed = 0;
        let eligibleCount = 0;
        let cleanedCount = 0;
        let alreadyCleanedCount = 0;
        let failedCount = 0;
        let reclaimedBytes = 0n;

        // 4. Process each enabled workspace according to its configured retention days
        for (const workspace of enabledWorkspaces) {
          const retentionDays = workspace.finalAssetRetentionDays;

          // Safe guard: validate custom retention period (1..365 days)
          if (
            typeof retentionDays !== "number" ||
            !Number.isInteger(retentionDays) ||
            retentionDays < 1 ||
            retentionDays > 365
          ) {
            console.warn(
              `[STORAGE_AUTO_CLEANUP_WARN] Workspace ${workspace.id} has invalid retention days: ${retentionDays}. Skipping.`
            );
            continue;
          }

          const cutoffDate = new Date(
            now.getTime() - retentionDays * 24 * 60 * 60 * 1000
          );
          const failedAssetIds = new Set<string>();
          let workspaceHadEligible = false;
          let batchIteration = 0;

          while (batchIteration < maxBatchesPerWorkspace) {
            batchIteration += 1;

            const candidates = await tx.finalAsset.findMany({
              where: {
                id: { notIn: Array.from(failedAssetIds) },
                researchItem: {
                  workspaceId: workspace.id,
                  status: ResearchStatus.LISTED,
                  listingResult: {
                    isNot: null,
                    is: {
                      listedAt: { lte: cutoffDate },
                    },
                  },
                },
                storageDeletedAt: null,
                storageKey: { not: "" },
              },
              select: {
                id: true,
                storageKey: true,
                fileSize: true,
              },
              orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
              take: batchSize,
            });

            if (candidates.length === 0) {
              break;
            }

            workspaceHadEligible = true;
            eligibleCount += candidates.length;

            let deletionResult: DeleteObjectsBatchResult;
            try {
              deletionResult = await deleteBatch(
                candidates.map((candidate) => candidate.storageKey)
              );
            } catch (error) {
              console.warn(
                `[STORAGE_AUTO_CLEANUP_WARN] R2 batch deletion command failed for workspace ${workspace.id}:`,
                error instanceof Error ? error.message : String(error)
              );
              failedCount += candidates.length;
              for (const candidate of candidates) {
                failedAssetIds.add(candidate.id);
              }
              break;
            }

            const deletedKeys = new Set(deletionResult.deletedKeys);
            const failedKeys = new Set(
              deletionResult.failed.map((failure) => failure.key)
            );

            const successfullyDeletedAssets = candidates.filter(
              (asset) =>
                deletedKeys.has(asset.storageKey) &&
                !failedKeys.has(asset.storageKey)
            );

            const batchFailedAssets = candidates.filter(
              (asset) =>
                !deletedKeys.has(asset.storageKey) ||
                failedKeys.has(asset.storageKey)
            );

            for (const failedAsset of batchFailedAssets) {
              failedAssetIds.add(failedAsset.id);
            }
            failedCount += batchFailedAssets.length;

            if (successfullyDeletedAssets.length > 0) {
              const storageDeletedAt = new Date();
              const updateResult = await tx.finalAsset.updateMany({
                where: {
                  id: {
                    in: successfullyDeletedAssets.map((asset) => asset.id),
                  },
                  storageDeletedAt: null,
                  researchItem: { workspaceId: workspace.id },
                },
                data: {
                  storageDeletedAt,
                  storageDeletedById: null,
                },
              });

              if (updateResult.count === successfullyDeletedAssets.length) {
                cleanedCount += successfullyDeletedAssets.length;
                reclaimedBytes += successfullyDeletedAssets.reduce(
                  (total, asset) => total + asset.fileSize,
                  0n
                );
              } else {
                const currentStates = await tx.finalAsset.findMany({
                  where: {
                    id: {
                      in: successfullyDeletedAssets.map((asset) => asset.id),
                    },
                    researchItem: { workspaceId: workspace.id },
                  },
                  select: {
                    id: true,
                    storageDeletedAt: true,
                    fileSize: true,
                  },
                });
                const statesById = new Map(
                  currentStates.map((state) => [state.id, state])
                );

                for (const asset of successfullyDeletedAssets) {
                  const current = statesById.get(asset.id);

                  if (
                    current?.storageDeletedAt?.getTime() ===
                    storageDeletedAt.getTime()
                  ) {
                    cleanedCount += 1;
                    reclaimedBytes += current.fileSize;
                  } else if (current?.storageDeletedAt !== null) {
                    alreadyCleanedCount += 1;
                  } else {
                    failedCount += 1;
                    failedAssetIds.add(asset.id);
                  }
                }
              }
            }

            if (candidates.length < batchSize) {
              break;
            }
          }

          if (workspaceHadEligible) {
            workspacesProcessed += 1;
          }
        }

        return {
          status: "completed",
          workspacesChecked: enabledWorkspaces.length,
          workspacesProcessed,
          eligibleCount,
          cleanedCount,
          alreadyCleanedCount,
          failedCount,
          reclaimedBytes: reclaimedBytes.toString(),
        };
      },
      {
        maxWait: 5000,
        timeout: 120000,
      }
    );
  } finally {
    isAutoCleanupInProgress = false;
  }
};
