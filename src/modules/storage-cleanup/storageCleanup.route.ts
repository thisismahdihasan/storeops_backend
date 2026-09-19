import { WorkspaceRole } from "@prisma/client";
import { Router } from "express";

import { requireAuth } from "../../middleware/requireAuth.js";
import { requireWorkspaceRole } from "../../middleware/requireWorkspaceRole.js";
import { catchAsync } from "../../utils/catchAsync.js";

import {
  cleanupFinalAsset,
  cleanupFinalAssetsBulk,
  getFinalAssetStorageMetrics,
  getStorageCleanupCandidates,
} from "./storageCleanup.controller.js";

const router: Router = Router({ mergeParams: true });

router.get(
  "/final-assets",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(getStorageCleanupCandidates)
);

router.get(
  "/metrics",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(getFinalAssetStorageMetrics)
);

router.delete(
  "/final-assets/:finalAssetId",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(cleanupFinalAsset)
);

router.post(
  "/final-assets/bulk-delete",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(cleanupFinalAssetsBulk)
);

export const StorageCleanupRoutes = router;
export default router;
