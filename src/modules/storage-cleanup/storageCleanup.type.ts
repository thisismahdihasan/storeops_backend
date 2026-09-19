export type StorageCleanupCandidate = {
  finalAssetId: string;
  researchItemId: string;
  etsyListingId: string;
  title: string | null;
  fileName: string;
  fileSize: string;
  uploadedAt: Date;
  listedAt: Date;
  storageDeletedAt: Date | null;
};

export type StorageCleanupCandidateListResult = {
  items: StorageCleanupCandidate[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type FinalAssetStorageMetric = {
  count: number;
  bytes: string;
};

export type FinalAssetStorageMetricsResult = {
  active: FinalAssetStorageMetric;
  reclaimable: FinalAssetStorageMetric;
  cleaned: FinalAssetStorageMetric;
};

export type FinalAssetCleanupResult = {
  finalAssetId: string;
  status: "CLEANED" | "ALREADY_CLEANED";
  reclaimedBytes: string;
  storageDeletedAt: Date;
};

export type BulkFinalAssetCleanupFailure = {
  finalAssetId: string;
  reason: string;
};

export type BulkFinalAssetCleanupResult = {
  requestedCount: number;
  cleanedCount: number;
  alreadyCleanedCount: number;
  failedCount: number;
  ineligibleCount: number;
  reclaimedBytes: string;
  failed: BulkFinalAssetCleanupFailure[];
};
