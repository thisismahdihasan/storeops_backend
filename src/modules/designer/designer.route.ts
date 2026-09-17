import { Router } from "express";
import { WorkspaceRole } from "@prisma/client";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireWorkspaceRole } from "../../middleware/requireWorkspaceRole.js";
import { catchAsync } from "../../utils/catchAsync.js";
import {
  getAdminDesignList,
  getDesignerWorkQueue,
  getDesignDetail,
  reportDesignIssue,
  startCorrection,
  startDesignWork,
  submitDesignReview,
  uploadFinalAssets,
  completeDesign,
  abortFinalAssetMultipartUpload,
  completeFinalAssetMultipartUpload,
  initFinalAssetMultipartUpload,
} from "./designer.controller.js";
import { reviewImageUploadMiddleware } from "./designer.upload.js";
import { finalAssetsUploadMiddleware } from "./designer.final-asset-upload.js";

const designerRouter: Router = Router({ mergeParams: true });

designerRouter.get(
  "/my-work",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.DESIGNER),
  catchAsync(getDesignerWorkQueue)
);

const designRouter: Router = Router({ mergeParams: true });

designRouter.get(
  "/",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(getAdminDesignList)
);

designRouter.get(
  "/:researchItemId",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.DESIGNER),
  catchAsync(getDesignDetail)
);

designRouter.post(
  "/:researchItemId/start",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.DESIGNER),
  catchAsync(startDesignWork)
);

designRouter.post(
  "/:researchItemId/report-issue",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.DESIGNER),
  catchAsync(reportDesignIssue)
);

designRouter.post(
  "/:researchItemId/review",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.DESIGNER),
  reviewImageUploadMiddleware,
  catchAsync(submitDesignReview)
);

designRouter.post(
  "/:researchItemId/start-correction",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.DESIGNER),
  catchAsync(startCorrection)
);

designRouter.post(
  "/:researchItemId/final-assets",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.DESIGNER),
  finalAssetsUploadMiddleware,
  catchAsync(uploadFinalAssets)
);

designRouter.post(
  "/:researchItemId/final-assets/multipart/init",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.DESIGNER),
  catchAsync(initFinalAssetMultipartUpload)
);

designRouter.post(
  "/:researchItemId/final-assets/multipart/complete",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.DESIGNER),
  catchAsync(completeFinalAssetMultipartUpload)
);

designRouter.post(
  "/:researchItemId/final-assets/multipart/abort",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.DESIGNER),
  catchAsync(abortFinalAssetMultipartUpload)
);

designRouter.post(
  "/:researchItemId/complete",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.DESIGNER),
  catchAsync(completeDesign)
);


export const DesignerRoutes = designerRouter;
export const DesignRoutes = designRouter;
export default designerRouter;
