import { Request, Response } from "express";
import { WorkspaceAuthorizedRequest } from "../../middleware/requireWorkspaceRole.js";
import { ApiError } from "../../shared/ApiError.js";
import { ApiResponse } from "../../shared/ApiResponse.js";
import * as listingService from "./listing.service.js";
import {
  backfillListingAssignmentsParamsSchema,
  assignListerBodySchema,
  bulkAssignListingBodySchema,
  getAdminListingListQuerySchema,
  getListerWorkQueueQuerySchema,
  getListerListingDetailParamsSchema,
  startListingBodySchema,
  startListingParamsSchema,
  downloadFinalAssetParamsSchema,
  completeListingBodySchema,
  completeListingParamsSchema,
} from "./listing.validation.js";

// Handles HTTP request for fetching the authenticated lister's active work queue.
export const getListerWorkQueue = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const rawWorkspaceId = req.params.workspaceId;
  const workspaceId = Array.isArray(rawWorkspaceId)
    ? rawWorkspaceId[0]
    : rawWorkspaceId;

  const validatedQuery = getListerWorkQueueQuerySchema.parse(req.query);

  const result = await listingService.getListerWorkQueue(
    workspaceId,
    authReq.user.id,
    validatedQuery
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Lister work queue retrieved successfully",
    data: result,
  });
};

// Returns active listing detail to the current assigned lister only.
export const getListerListingDetail = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } =
    getListerListingDetailParamsSchema.parse(req.params);

  const result = await listingService.getListerListingDetail(
    workspaceId,
    researchItemId,
    authReq.user.id
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Listing detail retrieved successfully",
    data: result,
  });
};

// Handles HTTP request for manually backfilling unassigned READY_FOR_LISTING items.
export const backfillListingAssignments = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { workspaceId } = backfillListingAssignmentsParamsSchema.parse(
    req.params
  );

  const result = await listingService.backfillUnassignedListings(workspaceId);

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Unassigned listings backfilled successfully",
    data: result,
  });
};

// Handles HTTP request for starting listing work on an assigned research item.
export const startListing = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } = startListingParamsSchema.parse(
    req.params
  );
  startListingBodySchema.parse(req.body);

  const result = await listingService.startListingWork(
    workspaceId,
    researchItemId,
    authReq.user.id
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Listing work started successfully",
    data: result,
  });
};

// Handles completion of listing work by the current assigned lister.
export const completeListing = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } = completeListingParamsSchema.parse(
    req.params
  );
  const input = completeListingBodySchema.parse(req.body);

  const result = await listingService.completeListingWork(
    workspaceId,
    researchItemId,
    authReq.user.id,
    input
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Listing completed successfully",
    data: result,
  });
};

type FinalAssetDownloadResolver =
  typeof listingService.getAuthorizedFinalAssetDownload;

// Builds the authorized redirect handler with an explicit resolver seam for deterministic provider-free tests.
export const createDownloadFinalAssetHandler = (
  resolveDownload: FinalAssetDownloadResolver =
    listingService.getAuthorizedFinalAssetDownload
) => {
  return async (
    req: Request,
    res: Response
  ): Promise<void> => {
    const authReq = req as WorkspaceAuthorizedRequest;
    const { workspaceId, assetId } = downloadFinalAssetParamsSchema.parse(
      req.params
    );
    const download = await resolveDownload(
      workspaceId,
      assetId,
      authReq.user.id
    );

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.redirect(302, download.downloadUrl);
  };
};

// Redirects an authorized final asset download to a short-lived private R2 URL.
export const downloadFinalAsset = createDownloadFinalAssetHandler();

// Returns paginated operational listing items for workspace Admins.
export const getAdminListingList = async (
  req: Request,
  res: Response
): Promise<void> => {
  const rawWorkspaceId = req.params.workspaceId;
  const workspaceId = Array.isArray(rawWorkspaceId)
    ? rawWorkspaceId[0]
    : rawWorkspaceId;

  if (!workspaceId) {
    throw new ApiError(400, "Workspace ID is required");
  }

  const query = getAdminListingListQuerySchema.parse(req.query);
  const result = await listingService.getAdminListingList(workspaceId, query);

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Admin listing list retrieved successfully",
    data: result,
  });
};

// Assigns one unassigned READY_FOR_LISTING item to an explicit workspace Lister.
export const assignLister = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { workspaceId, researchItemId } =
    getListerListingDetailParamsSchema.parse(req.params);
  const input = assignListerBodySchema.parse(req.body);
  const result = await listingService.assignLister(
    workspaceId,
    researchItemId,
    input.listerId
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Lister assigned successfully",
    data: result,
  });
};

// Assigns a selected unassigned listing batch to a target Lister or distributes it fairly.
export const bulkAssignListers = async (
  req: Request,
  res: Response
): Promise<void> => {
  const rawWorkspaceId = req.params.workspaceId;
  const workspaceId = Array.isArray(rawWorkspaceId)
    ? rawWorkspaceId[0]
    : rawWorkspaceId;
  const input = bulkAssignListingBodySchema.parse(req.body);
  const result = await listingService.bulkAssignListers(workspaceId, input);

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Listings assigned successfully",
    data: result,
  });
};
