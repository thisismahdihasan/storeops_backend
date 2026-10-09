import prisma from "../../lib/prisma.js";
import { destroyCloudinaryImage } from "../review/reviewCleanup.service.js";
import { deleteObjectsBatch } from "../storage/r2.js";
import {
  WORKSPACE_DELETION_GRACE_PERIOD_MS,
} from "./workspace.deletion.js";
import { acquireWorkspaceMemberMutationLock } from "./workspace.member-lock.js";

export type WorkspacePurgeRunResult = {
  status: "completed" | "already_running";
  scannedCount: number;
  claimedCount: number;
  purgedCount: number;
  failedCount: number;
  skippedCount: number;
};

const WORKSPACE_PURGE_LOCK_ID = 837261951;
const WORKSPACE_PURGE_BATCH_SIZE = 25;
const R2_DELETE_BATCH_SIZE = 1000;
// A workspace purge makes sequential Cloudinary calls and batched R2 calls; an
// hour leaves room for a legitimate attempt before a stale claim is retried.
const STALE_PURGE_CLAIM_MS = 60 * 60 * 1000;

let isWorkspacePurgeInProgress = false;

const alreadyRunningResult = (): WorkspacePurgeRunResult => ({
  status: "already_running",
  scannedCount: 0,
  claimedCount: 0,
  purgedCount: 0,
  failedCount: 0,
  skippedCount: 0,
});

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const claimExpiredWorkspaces = async (now: Date) => {
  const deletionCutoff = new Date(
    now.getTime() - WORKSPACE_DELETION_GRACE_PERIOD_MS
  );
  const staleClaimCutoff = new Date(now.getTime() - STALE_PURGE_CLAIM_MS);

  return await prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<[{ acquired: boolean }]>`
      SELECT pg_try_advisory_xact_lock(${WORKSPACE_PURGE_LOCK_ID}) AS acquired;
    `;

    if (!lockRows[0]?.acquired) {
      return null;
    }

    const candidates = await tx.workspace.findMany({
      where: {
        deletionScheduledAt: { lte: deletionCutoff },
        OR: [
          { purgeStartedAt: null },
          { purgeStartedAt: { lte: staleClaimCutoff } },
        ],
      },
      select: { id: true },
      orderBy: [{ deletionScheduledAt: "asc" }, { id: "asc" }],
      take: WORKSPACE_PURGE_BATCH_SIZE,
    });

    const claimedWorkspaceIds: string[] = [];

    for (const candidate of candidates) {
      await acquireWorkspaceMemberMutationLock(tx, candidate.id);

      const claim = await tx.workspace.updateMany({
        where: {
          id: candidate.id,
          deletionScheduledAt: { lte: deletionCutoff },
          OR: [
            { purgeStartedAt: null },
            { purgeStartedAt: { lte: staleClaimCutoff } },
          ],
        },
        data: { purgeStartedAt: now },
      });

      if (claim.count === 1) {
        claimedWorkspaceIds.push(candidate.id);
      }
    }

    return {
      scannedCount: candidates.length,
      claimedWorkspaceIds,
    };
  });
};

const collectWorkspaceAssets = async (workspaceId: string) => {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      researchItems: {
        select: {
          referenceImagePublicId: true,
          reviewSubmissions: {
            where: { imageDeletedAt: null },
            select: { imagePublicId: true },
          },
          finalAssets: {
            where: { storageDeletedAt: null },
            select: { storageKey: true },
          },
        },
      },
    },
  });

  if (!workspace) {
    return null;
  }

  const cloudinaryPublicIds = new Set<string>();
  const r2StorageKeys = new Set<string>();

  for (const researchItem of workspace.researchItems) {
    if (researchItem.referenceImagePublicId) {
      cloudinaryPublicIds.add(researchItem.referenceImagePublicId);
    }

    for (const review of researchItem.reviewSubmissions) {
      cloudinaryPublicIds.add(review.imagePublicId);
    }

    for (const finalAsset of researchItem.finalAssets) {
      if (finalAsset.storageKey) {
        r2StorageKeys.add(finalAsset.storageKey);
      }
    }
  }

  return {
    cloudinaryPublicIds: [...cloudinaryPublicIds],
    r2StorageKeys: [...r2StorageKeys],
  };
};

const deleteCloudinaryAssets = async (publicIds: string[]): Promise<boolean> => {
  let succeeded = true;

  for (const publicId of publicIds) {
    try {
      await destroyCloudinaryImage(publicId);
    } catch {
      succeeded = false;
    }
  }

  return succeeded;
};

const deleteR2Assets = async (storageKeys: string[]): Promise<boolean> => {
  for (const storageKeyBatch of chunk(storageKeys, R2_DELETE_BATCH_SIZE)) {
    try {
      const result = await deleteObjectsBatch(storageKeyBatch);
      const deletedKeys = new Set(result.deletedKeys);

      if (
        result.failed.length > 0 ||
        storageKeyBatch.some((storageKey) => !deletedKeys.has(storageKey))
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
};

const purgeClaimedWorkspace = async (
  workspaceId: string,
  claimStartedAt: Date
): Promise<"purged" | "failed" | "skipped"> => {
  const assets = await collectWorkspaceAssets(workspaceId);

  if (!assets) {
    return "skipped";
  }

  const cloudinaryDeleted = await deleteCloudinaryAssets(
    assets.cloudinaryPublicIds
  );
  const r2Deleted = await deleteR2Assets(assets.r2StorageKeys);

  if (!cloudinaryDeleted || !r2Deleted) {
    console.warn("Workspace purge external cleanup failed", { workspaceId });
    return "failed";
  }

  const deletion = await prisma.workspace.deleteMany({
    where: {
      id: workspaceId,
      purgeStartedAt: claimStartedAt,
    },
  });

  return deletion.count === 1 ? "purged" : "skipped";
};

// Purges a bounded batch of expired workspaces after their external assets are removed.
export const runWorkspacePurge = async (): Promise<WorkspacePurgeRunResult> => {
  if (isWorkspacePurgeInProgress) {
    return alreadyRunningResult();
  }

  isWorkspacePurgeInProgress = true;

  try {
    const now = new Date();
    const claimResult = await claimExpiredWorkspaces(now);

    if (!claimResult) {
      return alreadyRunningResult();
    }

    let purgedCount = 0;
    let failedCount = 0;
    let skippedCount = claimResult.scannedCount - claimResult.claimedWorkspaceIds.length;

    for (const workspaceId of claimResult.claimedWorkspaceIds) {
      const result = await purgeClaimedWorkspace(workspaceId, now);

      if (result === "purged") {
        purgedCount += 1;
      } else if (result === "failed") {
        failedCount += 1;
      } else {
        skippedCount += 1;
      }
    }

    return {
      status: "completed",
      scannedCount: claimResult.scannedCount,
      claimedCount: claimResult.claimedWorkspaceIds.length,
      purgedCount,
      failedCount,
      skippedCount,
    };
  } finally {
    isWorkspacePurgeInProgress = false;
  }
};
