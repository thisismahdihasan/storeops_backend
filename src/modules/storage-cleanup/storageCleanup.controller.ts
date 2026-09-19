import { Request, Response } from "express";

import { WorkspaceAuthorizedRequest } from "../../middleware/requireWorkspaceRole.js";
import { ApiResponse } from "../../shared/ApiResponse.js";

import * as storageCleanupService from "./storageCleanup.service.js";
import {
  bulkCleanupFinalAssetsBodySchema,
  getStorageCleanupCandidatesQuerySchema,
  storageCleanupFinalAssetParamsSchema,
  storageCleanupWorkspaceParamsSchema,
} from "./storageCleanup.validation.js";

export const getStorageCleanupCandidates = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { workspaceId } = storageCleanupWorkspaceParamsSchema.parse(req.params);
  const query = getStorageCleanupCandidatesQuerySchema.parse(req.query);
  const result = await storageCleanupService.getStorageCleanupCandidates(
    workspaceId,
    query
  );

  ApiResponse.success(res, {
    message: "Final ZIP cleanup candidates retrieved successfully",
    data: result,
  });
};

export const getFinalAssetStorageMetrics = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { workspaceId } = storageCleanupWorkspaceParamsSchema.parse(req.params);
  const result = await storageCleanupService.getFinalAssetStorageMetrics(
    workspaceId
  );

  ApiResponse.success(res, {
    message: "Final ZIP storage metrics retrieved successfully",
    data: result,
  });
};

export const cleanupFinalAsset = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, finalAssetId } =
    storageCleanupFinalAssetParamsSchema.parse(req.params);
  const result = await storageCleanupService.cleanupFinalAsset(
    workspaceId,
    finalAssetId,
    authReq.user.id
  );

  ApiResponse.success(res, {
    message: "Final ZIP cleanup processed successfully",
    data: result,
  });
};

export const cleanupFinalAssetsBulk = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId } = storageCleanupWorkspaceParamsSchema.parse(req.params);
  const input = bulkCleanupFinalAssetsBodySchema.parse(req.body);
  const result = await storageCleanupService.cleanupFinalAssetsBulk(
    workspaceId,
    authReq.user.id,
    input
  );

  ApiResponse.success(res, {
    message: "Final ZIP bulk cleanup processed successfully",
    data: result,
  });
};
