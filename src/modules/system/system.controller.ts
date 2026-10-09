import { Request, Response } from "express";
import { cleanupOldReviewImages } from "../review/reviewCleanup.service.js";
import { runFinalAssetAutoCleanup } from "../storage-cleanup/finalAssetAutoCleanup.service.js";
import { runWorkspacePurge } from "../workspace/workspacePurge.service.js";
import { ApiResponse } from "../../shared/ApiResponse.js";
import {
  cleanupFinalAssetsBodySchema,
  cleanupReviewsBodySchema,
  cleanupWorkspacesBodySchema,
} from "./system.validation.js";

// Runs the established review-image cleanup process with its production defaults.
export const cleanupReviewImages = async (
  req: Request,
  res: Response
): Promise<void> => {
  cleanupReviewsBodySchema.parse(req.body);

  const result = await cleanupOldReviewImages();

  ApiResponse.success(res, {
    message: "Review image cleanup completed successfully",
    data: result,
  });
};

// Runs the workspace-configured final asset storage retention cleanup.
export const cleanupFinalAssets = async (
  req: Request,
  res: Response
): Promise<void> => {
  cleanupFinalAssetsBodySchema.parse(req.body);

  const result = await runFinalAssetAutoCleanup();

  ApiResponse.success(res, {
    message: "Final asset auto-cleanup completed successfully",
    data: result,
  });
};

// Purges a bounded batch of expired workspaces after external cleanup succeeds.
export const cleanupWorkspaces = async (
  req: Request,
  res: Response
): Promise<void> => {
  cleanupWorkspacesBodySchema.parse(req.body);

  const result = await runWorkspacePurge();

  ApiResponse.success(res, {
    message: "Workspace purge completed successfully",
    data: result,
  });
};
