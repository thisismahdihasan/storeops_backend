import { NextFunction, Request, Response } from "express";
import { pipeline, Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { ResearchStatus } from "@prisma/client";
import { WorkspaceAuthorizedRequest } from "../../middleware/requireWorkspaceRole.js";
import { ApiError } from "../../shared/ApiError.js";
import { ApiResponse } from "../../shared/ApiResponse.js";
import {
  createByteLimitTransform,
  fetchSafeImageStream,
  isCloudinaryUrl,
} from "./research.referenceImage.js";
import { assignUnassignedResearchBacklog } from "./research.assignment.js";
import * as researchService from "./research.service.js";
import {
  createResearchItemSchema,
  bulkAssignResearchBodySchema,
  getIssueItemsQuerySchema,
  getReferenceImageQuerySchema,
  getResearchItemParamsSchema,
  getResearchItemsQuerySchema,
  previewResearchItemSchema,
  reassignDesignerBodySchema,
  updateResearchItemBodySchema,
} from "./research.validation.js";

// Creates a research item from an Etsy listing URL and automatically assigns an eligible designer.
// Supports both JSON bodies and multipart/form-data with an optional manual image file.
export const createResearchItem = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const rawWorkspaceId = req.params.workspaceId;
  const workspaceId = Array.isArray(rawWorkspaceId)
    ? rawWorkspaceId[0]
    : rawWorkspaceId;

  const validatedInput = createResearchItemSchema.parse(req.body);

  const manualImageFile = req.file
    ? {
        buffer: req.file.buffer,
        mimetype: req.file.mimetype,
      }
    : undefined;

  const researchItem = await researchService.createResearchItem(
    workspaceId,
    authReq.user.id,
    validatedInput,
    authReq.workspaceMembership.roles,
    { manualImageFile }
  );

  ApiResponse.success(res, {
    statusCode: 201,
    message: "Research item created successfully",
    data: {
      researchItem,
    },
  });
};

// Retrieves a paginated list of research items in the workspace with optional filters.
export const getResearchItems = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const rawWorkspaceId = req.params.workspaceId;
  const workspaceId = Array.isArray(rawWorkspaceId)
    ? rawWorkspaceId[0]
    : rawWorkspaceId;

  const validatedQuery = getResearchItemsQuerySchema.parse(req.query);

  const result = await researchService.getResearchItems(
    workspaceId,
    validatedQuery,
    authReq.user.id,
    authReq.workspaceMembership.roles
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Research items retrieved successfully",
    data: result,
  });
};

// Retrieves the ADMIN-only queue of currently reported design issues.
// The response reuses the normal safe research list projection, while the
// ISSUE_REPORTED status is enforced server-side rather than accepted from the client.
export const getIssueItems = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const rawWorkspaceId = req.params.workspaceId;
  const workspaceId = Array.isArray(rawWorkspaceId)
    ? rawWorkspaceId[0]
    : rawWorkspaceId;
  const validatedQuery = getIssueItemsQuerySchema.parse(req.query);

  const result = await researchService.getResearchItems(
    workspaceId,
    {
      ...validatedQuery,
      status: ResearchStatus.ISSUE_REPORTED,
    },
    authReq.user.id,
    authReq.workspaceMembership.roles
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Issue items retrieved successfully",
    data: result,
  });
};

// Fetches a single research item by ID within the authenticated workspace.
export const getResearchItemById = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } = getResearchItemParamsSchema.parse(
    req.params
  );

  const researchItem = await researchService.getResearchItemById(
    workspaceId,
    researchItemId,
    authReq.user.id,
    authReq.workspaceMembership.roles
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Research item retrieved successfully",
    data: {
      researchItem,
    },
  });
};

// Proxies or redirects the reference image stream with SSRF protection, size caps, and preview/download disposition.
export const getResearchReferenceImage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { workspaceId, researchItemId } = getResearchItemParamsSchema.parse(
    req.params
  );
  const { download } = getReferenceImageQuerySchema.parse(req.query);

  const authReq = req as WorkspaceAuthorizedRequest;
  const { referenceImageUrl } = await researchService.getAuthorizedReferenceImageData(
    workspaceId,
    researchItemId,
    authReq.user.id,
    authReq.workspaceMembership.roles
  );

  if (!download && isCloudinaryUrl(referenceImageUrl)) {
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.redirect(302, referenceImageUrl);
    return;
  }

  const imageResult = await fetchSafeImageStream(referenceImageUrl);

  let ext = "jpg";
  if (imageResult.contentType.includes("png")) ext = "png";
  else if (imageResult.contentType.includes("webp")) ext = "webp";
  else if (imageResult.contentType.includes("gif")) ext = "gif";
  else if (imageResult.contentType.includes("jpeg")) ext = "jpg";

  const filename = `research-reference-${researchItemId}.${ext}`;
  const dispositionType = download ? "attachment" : "inline";

  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Content-Type", imageResult.contentType);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader(
    "Content-Disposition",
    `${dispositionType}; filename="${filename}"`
  );

  const nodeReadable = Readable.fromWeb(
    imageResult.body as unknown as NodeReadableStream
  );
  const byteLimitTransform = createByteLimitTransform();

  pipeline(nodeReadable, byteLimitTransform, res, (err) => {
    if (err) {
      if (!res.headersSent) {
        next(err);
      } else {
        res.destroy(err);
      }
    }
  });
};

// Manually reassigns an existing research item to a different workspace designer.
export const reassignResearchDesigner = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { workspaceId, researchItemId } = getResearchItemParamsSchema.parse(
    req.params
  );
  const validatedBody = reassignDesignerBodySchema.parse(req.body);

  const result = await researchService.reassignResearchDesigner(
    workspaceId,
    researchItemId,
    validatedBody.designerId
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Designer reassigned successfully",
    data: result,
  });
};

// Assigns a selected, currently unassigned RESEARCHED batch to a target Designer or distributes it fairly.
export const bulkAssignResearchDesigners = async (
  req: Request,
  res: Response
): Promise<void> => {
  const rawWorkspaceId = req.params.workspaceId;
  const workspaceId = Array.isArray(rawWorkspaceId)
    ? rawWorkspaceId[0]
    : rawWorkspaceId;
  const input = bulkAssignResearchBodySchema.parse(req.body);

  const result = await researchService.bulkAssignResearchDesigners(
    workspaceId,
    input
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Research items assigned successfully",
    data: result,
  });
};

// Previews Etsy listing metadata and duplicate status without creating database records.
export const previewResearchItem = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const rawWorkspaceId = req.params.workspaceId;
  const workspaceId = Array.isArray(rawWorkspaceId)
    ? rawWorkspaceId[0]
    : rawWorkspaceId;

  const validatedInput = previewResearchItemSchema.parse(req.body);

  const preview = await researchService.previewResearchItem(
    workspaceId,
    validatedInput,
    authReq.workspaceMembership.roles
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Research preview retrieved successfully",
    data: preview,
  });
};

// Uploads and updates the reference image for an existing research item manually.
export const uploadResearchReferenceImage = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, researchItemId } = getResearchItemParamsSchema.parse(
    req.params
  );

  if (!req.file) {
    throw new ApiError(400, "Image file is required on 'image' field");
  }

  const result = await researchService.uploadResearchReferenceImage(
    workspaceId,
    researchItemId,
    authReq.user.id,
    authReq.workspaceMembership.roles,
    {
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
    }
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Research reference image updated successfully",
    data: result,
  });
};

// Updates minimal research item metadata (title) for an existing item.
export const updateResearchItem = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { workspaceId, researchItemId } = getResearchItemParamsSchema.parse(
    req.params
  );
  const validatedBody = updateResearchItemBodySchema.parse(req.body);

  const researchItem = await researchService.updateResearchItem(
    workspaceId,
    researchItemId,
    validatedBody
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Research item updated successfully",
    data: {
      researchItem,
    },
  });
};

// Deletes an early-stage research item and its initial setup records safely.
export const deleteResearchItem = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { workspaceId, researchItemId } = getResearchItemParamsSchema.parse(
    req.params
  );

  const result = await researchService.deleteResearchItem(
    workspaceId,
    researchItemId
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Research item deleted successfully",
    data: result,
  });
};

// Assigns all currently unassigned RESEARCHED items to eligible Designers using least-load
// balancing. ADMIN only. Idempotent — safe to run repeatedly with no side-effects.
export const syncResearchAssignments = async (
  req: Request,
  res: Response
): Promise<void> => {
  const rawWorkspaceId = req.params.workspaceId;
  const workspaceId = Array.isArray(rawWorkspaceId)
    ? rawWorkspaceId[0]
    : rawWorkspaceId;

  const result = await assignUnassignedResearchBacklog(workspaceId);

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Backlog assignment sync completed",
    data: result,
  });
};
