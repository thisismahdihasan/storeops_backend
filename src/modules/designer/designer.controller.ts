import fs from "node:fs";
import { Request, Response } from "express";
import { WorkspaceAuthorizedRequest } from "../../middleware/requireWorkspaceRole.js";
import { ApiError } from "../../shared/ApiError.js";
import { ApiResponse } from "../../shared/ApiResponse.js";
import * as designerService from "./designer.service.js";
import {
  ReviewImageDestroyer,
  ReviewImageUploader,
} from "./designer.review-storage.js";
import { FinalAssetIncomingFile } from "./designer.type.js";
import {
  abortFinalAssetMultipartUploadBodySchema,
  completeDesignBodySchema,
  completeDesignParamsSchema,
  completeFinalAssetMultipartUploadBodySchema,
  getAdminDesignListQuerySchema,
  getDesignerWorkQueueQuerySchema,
  getDesignDetailParamsSchema,
  initFinalAssetMultipartUploadBodySchema,
  multipartFinalAssetParamsSchema,
  reportDesignIssueBodySchema,
  reportDesignIssueParamsSchema,
  startCorrectionBodySchema,
  startCorrectionParamsSchema,
  startDesignWorkParamsSchema,
  submitDesignReviewBodySchema,
  submitDesignReviewParamsSchema,
  uploadFinalAssetsParamsSchema,
} from "./designer.validation.js";

// Returns the authenticated current designer's private design-work detail.
export const getDesignDetail = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } = getDesignDetailParamsSchema.parse(
    req.params
  );

  const result = await designerService.getDesignDetail(
    workspaceId,
    researchItemId,
    authReq.user.id
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Design detail retrieved successfully",
    data: result,
  });
};

// Handles HTTP request for fetching the authenticated designer's active work queue.
export const getDesignerWorkQueue = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const rawWorkspaceId = req.params.workspaceId;
  const workspaceId = Array.isArray(rawWorkspaceId)
    ? rawWorkspaceId[0]
    : rawWorkspaceId;

  const validatedQuery = getDesignerWorkQueueQuerySchema.parse(req.query);

  const result = await designerService.getDesignerWorkQueue(
    workspaceId,
    authReq.user.id,
    validatedQuery
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Designer work queue retrieved successfully",
    data: result,
  });
};

// Handles HTTP request for starting research/design work on an assigned item.
export const startDesignWork = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } = startDesignWorkParamsSchema.parse(
    req.params
  );

  const result = await designerService.startDesignWork(
    workspaceId,
    researchItemId,
    authReq.user.id
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Design work started successfully",
    data: result,
  });
};

// Handles HTTP request for reporting an issue on an assigned research item.
export const reportDesignIssue = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } = reportDesignIssueParamsSchema.parse(
    req.params
  );
  const validatedBody = reportDesignIssueBodySchema.parse(req.body);

  const result = await designerService.reportAssignedDesignIssue(
    workspaceId,
    researchItemId,
    authReq.user.id,
    validatedBody
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Design issue reported successfully",
    data: result,
  });
};

// Handles HTTP request for submitting an assigned design for review.
export const submitDesignReview = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } = submitDesignReviewParamsSchema.parse(
    req.params
  );
  const validatedBody = submitDesignReviewBodySchema.parse(req.body);

  if (!req.file || !req.file.buffer) {
    throw new ApiError(400, "Image file is required");
  }

  const uploader = req.app?.get("reviewImageUploader") as
    | ReviewImageUploader
    | undefined;
  const destroyer = req.app?.get("reviewImageDestroyer") as
    | ReviewImageDestroyer
    | undefined;

  const result = await designerService.submitAssignedDesignReview(
    workspaceId,
    researchItemId,
    authReq.user.id,
    {
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
    },
    validatedBody.note,
    uploader,
    destroyer
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Design submitted for review successfully",
    data: result,
  });
};

// Handles HTTP request for starting correction work on an assigned research item.
export const startCorrection = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } = startCorrectionParamsSchema.parse(
    req.params
  );
  startCorrectionBodySchema.parse(req.body);

  const result = await designerService.startCorrection(
    workspaceId,
    researchItemId,
    authReq.user.id
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Design correction started successfully",
    data: result,
  });
};

// Handles HTTP request for uploading final production files to StoreOps' configured storage provider.
export const uploadFinalAssets = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } = uploadFinalAssetsParamsSchema.parse(
    req.params
  );

  const rawFiles = req.files as Express.Multer.File[] | undefined;
  if (!rawFiles || !Array.isArray(rawFiles) || rawFiles.length !== 1) {
    throw new ApiError(400, "Exactly one final asset file is required");
  }

  const incomingFiles: FinalAssetIncomingFile[] = rawFiles.map((f) => ({
    path: f.path,
    originalname: f.originalname,
    mimetype: f.mimetype,
    size: f.size,
  }));

  try {
    const result = await designerService.uploadFinalAssets(
      workspaceId,
      researchItemId,
      authReq.user.id,
      incomingFiles
    );

    ApiResponse.success(res, {
      statusCode: 200,
      message: "Final assets uploaded successfully",
      data: result,
    });
  } finally {
    // Defensively unlink all temporary files regardless of success or failure
    for (const f of rawFiles) {
      if (f.path) {
        try {
          await fs.promises.unlink(f.path);
        } catch {
          // Ignore if already unlinked or cleaned
        }
      }
    }
  }
};

// Creates a signed, workspace-bound R2 multipart upload session for one approved final ZIP.
export const initFinalAssetMultipartUpload = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } = multipartFinalAssetParamsSchema.parse(
    req.params
  );
  const input = initFinalAssetMultipartUploadBodySchema.parse(req.body);
  const result = await designerService.initFinalAssetMultipartUpload(
    workspaceId,
    researchItemId,
    authReq.user.id,
    input
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Multipart final asset upload initialized successfully",
    data: result,
  });
};

// Verifies a signed multipart session and persists its completed, verified ZIP through the legacy-safe invariant.
export const completeFinalAssetMultipartUpload = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } = multipartFinalAssetParamsSchema.parse(
    req.params
  );
  const input = completeFinalAssetMultipartUploadBodySchema.parse(req.body);
  const result = await designerService.completeFinalAssetMultipartUpload(
    workspaceId,
    researchItemId,
    authReq.user.id,
    input
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Multipart final asset upload completed successfully",
    data: result,
  });
};

// Cancels an incomplete multipart upload without creating or changing a FinalAsset record.
export const abortFinalAssetMultipartUpload = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } = multipartFinalAssetParamsSchema.parse(
    req.params
  );
  const { sessionToken } = abortFinalAssetMultipartUploadBodySchema.parse(
    req.body
  );

  await designerService.abortFinalAssetMultipartUpload(
    workspaceId,
    researchItemId,
    authReq.user.id,
    sessionToken
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Multipart final asset upload aborted successfully",
    data: {},
  });
};

// Handles HTTP request for completing design work after final assets upload, transitioning status to READY_FOR_LISTING.
export const completeDesign = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } = completeDesignParamsSchema.parse(
    req.params
  );
  completeDesignBodySchema.parse(req.body);

  const result = await designerService.completeDesignWork(
    workspaceId,
    researchItemId,
    authReq.user.id
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Design completed and marked ready for listing successfully",
    data: result,
  });
};

// Returns paginated operational design items for workspace Admins.
export const getAdminDesignList = async (
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

  const query = getAdminDesignListQuerySchema.parse(req.query);
  const result = await designerService.getAdminDesignList(workspaceId, query);

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Admin design list retrieved successfully",
    data: result,
  });
};
