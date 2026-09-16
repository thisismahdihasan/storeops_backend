import { Router } from "express";
import { WorkspaceRole } from "@prisma/client";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireWorkspaceRole } from "../../middleware/requireWorkspaceRole.js";
import { catchAsync } from "../../utils/catchAsync.js";
import {
  approveReviewSubmission,
  createAnnotationReply,
  createReviewAnnotation,
  deleteAnnotationReply,
  deleteReviewAnnotation,
  requestReviewCorrection,
  getReviewDetail,
  getReviewQueue,
  updateAnnotationReply,
  updateReviewAnnotation,
} from "./review.controller.js";

const reviewRouter: Router = Router({ mergeParams: true });

reviewRouter.get(
  "/",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(getReviewQueue)
);

reviewRouter.get(
  "/:reviewId",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN, WorkspaceRole.DESIGNER),
  catchAsync(getReviewDetail)
);

reviewRouter.post(
  "/:reviewId/annotations",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(createReviewAnnotation)
);

reviewRouter.post(
  "/:reviewId/request-correction",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(requestReviewCorrection)
);

reviewRouter.post(
  "/:reviewId/approve",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(approveReviewSubmission)
);

const annotationRouter: Router = Router({ mergeParams: true });

annotationRouter.patch(
  "/:annotationId",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(updateReviewAnnotation)
);

annotationRouter.delete(
  "/:annotationId",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(deleteReviewAnnotation)
);

annotationRouter.post(
  "/:annotationId/replies",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN, WorkspaceRole.DESIGNER),
  catchAsync(createAnnotationReply)
);

annotationRouter.patch(
  "/:annotationId/replies/:replyId",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN, WorkspaceRole.DESIGNER),
  catchAsync(updateAnnotationReply)
);

annotationRouter.delete(
  "/:annotationId/replies/:replyId",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN, WorkspaceRole.DESIGNER),
  catchAsync(deleteAnnotationReply)
);

export const ReviewRoutes = reviewRouter;
export const AnnotationRoutes = annotationRouter;
export default reviewRouter;
