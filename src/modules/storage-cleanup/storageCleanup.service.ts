import { Prisma, ResearchStatus } from "@prisma/client";

import prisma from "../../lib/prisma.js";
import { ApiError } from "../../shared/ApiError.js";
import { deleteObject, deleteObjectsBatch } from "../storage/r2.js";

import type {
  BulkFinalAssetCleanupFailure,
  BulkFinalAssetCleanupResult,
  FinalAssetCleanupResult,
  FinalAssetStorageMetric,
  FinalAssetStorageMetricsResult,
  StorageCleanupCandidateListResult,
} from "./storageCleanup.type.js";
import type {
  BulkCleanupFinalAssetsBodyInput,
  GetStorageCleanupCandidatesQueryInput,
} from "./storageCleanup.validation.js";

type FinalAssetCleanupRecord = {
  id: string;
  storageKey: string;
  storageDeletedAt: Date | null;
  fileSize: bigint;
  researchItem: {
    status: ResearchStatus;
    listingResult: { id: string } | null;
  };
};

const cleanupAssetSelect = {
  id: true,
  storageKey: true,
  storageDeletedAt: true,
  fileSize: true,
  researchItem: {
    select: {
      status: true,
      listingResult: {
        select: { id: true },
      },
    },
  },
} as const;

const listedFinalAssetWhere = (
  workspaceId: string
): Prisma.FinalAssetWhereInput => ({
  researchItem: {
    workspaceId,
    status: ResearchStatus.LISTED,
    listingResult: { isNot: null },
  },
});

const eligibleFinalAssetWhere = (
  workspaceId: string
): Prisma.FinalAssetWhereInput => ({
  ...listedFinalAssetWhere(workspaceId),
  storageDeletedAt: null,
  storageKey: { not: "" },
});

const getCleanupIneligibilityReason = (
  asset: FinalAssetCleanupRecord
): string | null => {
  if (asset.researchItem.status !== ResearchStatus.LISTED) {
    return "Final assets can only be cleaned after the item is listed.";
  }

  if (!asset.researchItem.listingResult) {
    return "The listed item is missing its published listing result.";
  }

  if (asset.storageKey.trim().length === 0) {
    return "The final asset does not have a valid storage record.";
  }

  return null;
};

const storageCleanupFailure = (): ApiError =>
  new ApiError(502, "Failed to remove the production ZIP package from storage.");

const toStorageMetric = (aggregate: {
  _count: { _all: number };
  _sum: { fileSize: bigint | null };
}): FinalAssetStorageMetric => ({
  count: aggregate._count._all,
  bytes: (aggregate._sum.fileSize ?? 0n).toString(),
});

const toCandidateWhere = (
  workspaceId: string,
  filter: GetStorageCleanupCandidatesQueryInput["filter"]
): Prisma.FinalAssetWhereInput => {
  if (filter === "ELIGIBLE") {
    return eligibleFinalAssetWhere(workspaceId);
  }

  if (filter === "CLEANED") {
    return {
      ...listedFinalAssetWhere(workspaceId),
      storageDeletedAt: { not: null },
    };
  }

  return listedFinalAssetWhere(workspaceId);
};

export const getStorageCleanupCandidates = async (
  workspaceId: string,
  query: GetStorageCleanupCandidatesQueryInput
): Promise<StorageCleanupCandidateListResult> => {
  const { page, limit, search, filter } = query;
  const where = toCandidateWhere(workspaceId, filter);

  if (search) {
    where.AND = [
      {
        researchItem: {
          OR: [
            { etsyListingId: { contains: search, mode: "insensitive" } },
            { title: { contains: search, mode: "insensitive" } },
          ],
        },
      },
    ];
  }

  const skip = (page - 1) * limit;
  const orderBy: Prisma.FinalAssetOrderByWithRelationInput[] =
    filter === "CLEANED"
      ? [{ storageDeletedAt: "desc" }, { id: "desc" }]
      : [
          { researchItem: { listingResult: { listedAt: "asc" } } },
          { id: "asc" },
        ];

  const [assets, total] = await prisma.$transaction([
    prisma.finalAsset.findMany({
      where,
      select: {
        id: true,
        fileName: true,
        fileSize: true,
        uploadedAt: true,
        storageDeletedAt: true,
        researchItem: {
          select: {
            id: true,
            etsyListingId: true,
            title: true,
            listingResult: {
              select: { listedAt: true },
            },
          },
        },
      },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.finalAsset.count({ where }),
  ]);

  const items = assets.map((asset) => {
    const listedAt = asset.researchItem.listingResult?.listedAt;
    if (!listedAt) {
      throw new ApiError(500, "A listed final asset is missing its listing result.");
    }

    return {
      finalAssetId: asset.id,
      researchItemId: asset.researchItem.id,
      etsyListingId: asset.researchItem.etsyListingId,
      title: asset.researchItem.title,
      fileName: asset.fileName,
      fileSize: asset.fileSize.toString(),
      uploadedAt: asset.uploadedAt,
      listedAt,
      storageDeletedAt: asset.storageDeletedAt,
    };
  });

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
};

export const getFinalAssetStorageMetrics = async (
  workspaceId: string
): Promise<FinalAssetStorageMetricsResult> => {
  const workspaceAssetWhere: Prisma.FinalAssetWhereInput = {
    researchItem: { workspaceId },
  };

  const [active, reclaimable, cleaned] = await Promise.all([
    prisma.finalAsset.aggregate({
      where: { ...workspaceAssetWhere, storageDeletedAt: null },
      _count: { _all: true },
      _sum: { fileSize: true },
    }),
    prisma.finalAsset.aggregate({
      where: {
        ...listedFinalAssetWhere(workspaceId),
        storageDeletedAt: null,
      },
      _count: { _all: true },
      _sum: { fileSize: true },
    }),
    prisma.finalAsset.aggregate({
      where: { ...workspaceAssetWhere, storageDeletedAt: { not: null } },
      _count: { _all: true },
      _sum: { fileSize: true },
    }),
  ]);

  return {
    active: toStorageMetric(active),
    reclaimable: toStorageMetric(reclaimable),
    cleaned: toStorageMetric(cleaned),
  };
};

export const cleanupFinalAsset = async (
  workspaceId: string,
  finalAssetId: string,
  adminUserId: string
): Promise<FinalAssetCleanupResult> => {
  const asset = await prisma.finalAsset.findFirst({
    where: {
      id: finalAssetId,
      researchItem: { workspaceId },
    },
    select: cleanupAssetSelect,
  });

  if (!asset) {
    throw new ApiError(404, "Final asset not found");
  }

  if (asset.storageDeletedAt !== null) {
    return {
      finalAssetId: asset.id,
      status: "ALREADY_CLEANED",
      reclaimedBytes: "0",
      storageDeletedAt: asset.storageDeletedAt,
    };
  }

  const ineligibilityReason = getCleanupIneligibilityReason(asset);
  if (ineligibilityReason) {
    throw new ApiError(409, ineligibilityReason);
  }

  try {
    await deleteObject(asset.storageKey);
  } catch {
    throw storageCleanupFailure();
  }

  const storageDeletedAt = new Date();
  const updateResult = await prisma.finalAsset.updateMany({
    where: {
      id: asset.id,
      storageDeletedAt: null,
      researchItem: { workspaceId },
    },
    data: {
      storageDeletedAt,
      storageDeletedById: adminUserId,
    },
  });

  if (updateResult.count === 0) {
    const currentAsset = await prisma.finalAsset.findFirst({
      where: {
        id: asset.id,
        researchItem: { workspaceId },
      },
      select: { storageDeletedAt: true },
    });

    if (currentAsset?.storageDeletedAt) {
      return {
        finalAssetId: asset.id,
        status: "ALREADY_CLEANED",
        reclaimedBytes: "0",
        storageDeletedAt: currentAsset.storageDeletedAt,
      };
    }

    throw new ApiError(409, "Final asset cleanup state changed. Please retry.");
  }

  return {
    finalAssetId: asset.id,
    status: "CLEANED",
    reclaimedBytes: asset.fileSize.toString(),
    storageDeletedAt,
  };
};

export const cleanupFinalAssetsBulk = async (
  workspaceId: string,
  adminUserId: string,
  input: BulkCleanupFinalAssetsBodyInput
): Promise<BulkFinalAssetCleanupResult> => {
  const assets = await prisma.finalAsset.findMany({
    where: {
      id: { in: input.finalAssetIds },
      researchItem: { workspaceId },
    },
    select: cleanupAssetSelect,
  });
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const eligibleAssets: FinalAssetCleanupRecord[] = [];
  const failed: BulkFinalAssetCleanupFailure[] = [];
  let alreadyCleanedCount = 0;
  let ineligibleCount = 0;

  for (const finalAssetId of input.finalAssetIds) {
    const asset = assetsById.get(finalAssetId);

    if (!asset) {
      ineligibleCount += 1;
      failed.push({
        finalAssetId,
        reason: "Final asset was not found in this workspace.",
      });
      continue;
    }

    if (asset.storageDeletedAt !== null) {
      alreadyCleanedCount += 1;
      continue;
    }

    const ineligibilityReason = getCleanupIneligibilityReason(asset);
    if (ineligibilityReason) {
      ineligibleCount += 1;
      failed.push({ finalAssetId, reason: ineligibilityReason });
      continue;
    }

    eligibleAssets.push(asset);
  }

  if (eligibleAssets.length === 0) {
    return {
      requestedCount: input.finalAssetIds.length,
      cleanedCount: 0,
      alreadyCleanedCount,
      failedCount: failed.length,
      ineligibleCount,
      reclaimedBytes: "0",
      failed,
    };
  }

  let deletionResult;
  try {
    deletionResult = await deleteObjectsBatch(
      eligibleAssets.map((asset) => asset.storageKey)
    );
  } catch {
    throw storageCleanupFailure();
  }

  const deletedKeys = new Set(deletionResult.deletedKeys);
  const failedKeys = new Set(deletionResult.failed.map((failure) => failure.key));
  const successfullyDeletedAssets = eligibleAssets.filter((asset) =>
    deletedKeys.has(asset.storageKey) && !failedKeys.has(asset.storageKey)
  );

  for (const asset of eligibleAssets) {
    if (
      deletedKeys.has(asset.storageKey) &&
      !failedKeys.has(asset.storageKey)
    ) {
      continue;
    }

    failed.push({
      finalAssetId: asset.id,
      reason: failedKeys.has(asset.storageKey)
        ? "The production ZIP package could not be removed from storage."
        : "Storage did not confirm removal of the production ZIP package.",
    });
  }

  let cleanedCount = 0;
  let reclaimedBytes = 0n;

  if (successfullyDeletedAssets.length > 0) {
    const storageDeletedAt = new Date();
    const updateResult = await prisma.finalAsset.updateMany({
      where: {
        id: { in: successfullyDeletedAssets.map((asset) => asset.id) },
        storageDeletedAt: null,
        researchItem: { workspaceId },
      },
      data: {
        storageDeletedAt,
        storageDeletedById: adminUserId,
      },
    });

    if (updateResult.count === successfullyDeletedAssets.length) {
      cleanedCount = successfullyDeletedAssets.length;
      reclaimedBytes = successfullyDeletedAssets.reduce(
        (total, asset) => total + asset.fileSize,
        0n
      );
    } else {
      const currentStates = await prisma.finalAsset.findMany({
        where: {
          id: { in: successfullyDeletedAssets.map((asset) => asset.id) },
          researchItem: { workspaceId },
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

        if (!current) {
          failed.push({
            finalAssetId: asset.id,
            reason: "The final asset was no longer found in this workspace.",
          });
        } else if (
          current.storageDeletedAt?.getTime() === storageDeletedAt.getTime()
        ) {
          cleanedCount += 1;
          reclaimedBytes += current.fileSize;
        } else if (current.storageDeletedAt !== null) {
          alreadyCleanedCount += 1;
        } else {
          failed.push({
            finalAssetId: current.id,
            reason: "The final asset cleanup state could not be recorded.",
          });
        }
      }
    }
  }

  return {
    requestedCount: input.finalAssetIds.length,
    cleanedCount,
    alreadyCleanedCount,
    failedCount: failed.length,
    ineligibleCount,
    reclaimedBytes: reclaimedBytes.toString(),
    failed,
  };
};

