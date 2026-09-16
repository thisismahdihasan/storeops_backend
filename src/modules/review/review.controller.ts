import { Request, Response } from "express";
import { WorkspaceAuthorizedRequest } from "../../middleware/requireWorkspaceRole.js";
import { ApiResponse } from "../../shared/ApiResponse.js";
import * as reviewService from "./review.service.js";
import {
  approveReviewBodySchema,
  approveReviewParamsSchema,
  createAnnotationReplyBodySchema,
  createAnnotationReplyParamsSchema,
  createReviewAnnotationBodySchema,
  createReviewAnnotationParamsSchema,
  annotationMutationParamsSchema,
  annotationReplyMutationParamsSchema,
  requestCorrectionBodySchema,
  requestCorrectionParamsSchema,
  getReviewDetailParamsSchema,
  getReviewQueueParamsSchema,
  getReviewQueueQuerySchema,
  updateAnnotationReplyBodySchema,
  updateReviewAnnotationBodySchema,
} from "./review.validation.js";

// Returns review submissions currently awaiting ADMIN action.
export const getReviewQueue = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { workspaceId } = getReviewQueueParamsSchema.parse(req.params);
  const query = getReviewQueueQuerySchema.parse(req.query);
  const result = await reviewService.getReviewQueue(workspaceId, query);

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Review queue retrieved successfully",
    data: result,
  });
};

// Returns one accessible review with its complete history and annotation threads.
export const getReviewDetail = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, reviewId } = getReviewDetailParamsSchema.parse(
    req.params
  );
  const result = await reviewService.getReviewDetail(
    workspaceId,
    reviewId,
    authReq.user.id,
    authReq.workspaceMembership.roles
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Review retrieved successfully",
    data: result,
  });
};

// Handles HTTP request for creating an annotation on the current review screenshot.
export const createReviewAnnotation = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, reviewId } = createReviewAnnotationParamsSchema.parse(
    req.params
  );
  const validatedBody = createReviewAnnotationBodySchema.parse(req.body);

  const result = await reviewService.createReviewAnnotation(
    workspaceId,
    reviewId,
    authReq.user.id,
    validatedBody
  );

  ApiResponse.success(res, {
    statusCode: 201,
    message: "Review annotation created successfully",
    data: result,
  });
};

// Handles HTTP request for creating a threaded reply on an existing review annotation.
export const createAnnotationReply = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, annotationId } =
    createAnnotationReplyParamsSchema.parse(req.params);
  const validatedBody = createAnnotationReplyBodySchema.parse(req.body);

  const result = await reviewService.createAnnotationReply(
    workspaceId,
    annotationId,
    authReq.user.id,
    validatedBody
  );

  ApiResponse.success(res, {
    statusCode: 201,
    message: "Annotation reply created successfully",
    data: result,
  });
};

export const updateReviewAnnotation = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, annotationId } = annotationMutationParamsSchema.parse(
    req.params
  );
  const body = updateReviewAnnotationBodySchema.parse(req.body);
  const result = await reviewService.updateReviewAnnotation(
    workspaceId,
    annotationId,
    authReq.user.id,
    body
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Review annotation updated successfully",
    data: result,
  });
};

export const deleteReviewAnnotation = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, annotationId } = annotationMutationParamsSchema.parse(
    req.params
  );
  const result = await reviewService.deleteReviewAnnotation(
    workspaceId,
    annotationId,
    authReq.user.id
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Review annotation deleted successfully",
    data: result,
  });
};

export const updateAnnotationReply = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, annotationId, replyId } =
    annotationReplyMutationParamsSchema.parse(req.params);
  const body = updateAnnotationReplyBodySchema.parse(req.body);
  const result = await reviewService.updateAnnotationReply(
    workspaceId,
    annotationId,
    replyId,
    authReq.user.id,
    body
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Annotation reply updated successfully",
    data: result,
  });
};

export const deleteAnnotationReply = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, annotationId, replyId } =
    annotationReplyMutationParamsSchema.parse(req.params);
  const result = await reviewService.deleteAnnotationReply(
    workspaceId,
    annotationId,
    replyId,
    authReq.user.id
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Annotation reply deleted successfully",
    data: result,
  });
};

// Handles HTTP request for requesting design corrections on the current review round.
export const requestReviewCorrection = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { workspaceId, reviewId } = requestCorrectionParamsSchema.parse(
    req.params
  );
  requestCorrectionBodySchema.parse(req.body);

  const result = await reviewService.requestReviewCorrection(
    workspaceId,
    reviewId
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Correction requested successfully",
    data: result,
  });
};

// Handles HTTP request for approving the current review round.
export const approveReviewSubmission = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as WorkspaceAuthorizedRequest;
  const { workspaceId, reviewId } = approveReviewParamsSchema.parse(
    req.params
  );
  approveReviewBodySchema.parse(req.body);

  const result = await reviewService.approveReviewSubmission(
    workspaceId,
    reviewId,
    authReq.user.id
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Design approved successfully",
    data: result,
  });
};
