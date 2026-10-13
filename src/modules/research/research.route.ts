import { Router } from "express";
import { WorkspaceRole } from "@prisma/client";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireWorkspaceRole } from "../../middleware/requireWorkspaceRole.js";
import { catchAsync } from "../../utils/catchAsync.js";
import {
  createResearchItem,
  bulkAssignResearchDesigners,
  deleteResearchItem,
  getIssueItems,
  getResearchItemById,
  getReferenceUsageHistory,
  getResearchItems,
  getResearchSummary,
  getResearchReferenceImage,
  previewResearchItem,
  reassignResearchDesigner,
  syncResearchAssignments,
  updateResearchItem,
  uploadResearchReferenceImage,
} from "./research.controller.js";
import {
  optionalReferenceImageUploadMiddleware,
  referenceImageUploadMiddleware,
} from "./research.upload.js";

const router: Router = Router({ mergeParams: true });

router.post(
  "/preview",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.RESEARCHER),
  catchAsync(previewResearchItem)
);

router.post(
  "/",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.RESEARCHER),
  optionalReferenceImageUploadMiddleware,
  catchAsync(createResearchItem)
);

router.get(
  "/",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN, WorkspaceRole.RESEARCHER),
  catchAsync(getResearchItems)
);

// Registered before /:researchItemId so "issues" is never interpreted as an item ID.
router.get(
  "/issues",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(getIssueItems)
);

router.patch(
  "/:researchItemId/designer",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(reassignResearchDesigner)
);

router.get(
  "/references/:etsyListingId/history",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(getReferenceUsageHistory),
);

// Registered before /:researchItemId so "my-summary" is never interpreted as an item ID.
router.get(
  "/my-summary",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.RESEARCHER),
  catchAsync(getResearchSummary)
);

router.post(
  "/bulk-assign",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(bulkAssignResearchDesigners)
);

// Sync unassigned RESEARCHED backlog to eligible Designers (ADMIN only, idempotent).
// Registered before /:researchItemId routes to prevent "sync-assignments" being matched
// as a researchItemId param by any future POST /:researchItemId route.
router.post(
  "/sync-assignments",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(syncResearchAssignments)
);

router.post(
  "/:researchItemId/reference-image",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN, WorkspaceRole.RESEARCHER),
  referenceImageUploadMiddleware,
  catchAsync(uploadResearchReferenceImage)
);

router.get(
  "/:researchItemId/reference-image",
  requireAuth,
  requireWorkspaceRole(
    WorkspaceRole.ADMIN,
    WorkspaceRole.RESEARCHER,
    WorkspaceRole.DESIGNER,
    WorkspaceRole.LISTER
  ),
  catchAsync(getResearchReferenceImage)
);

router.patch(
  "/:researchItemId",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(updateResearchItem)
);

router.delete(
  "/:researchItemId",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(deleteResearchItem)
);

router.get(
  "/:researchItemId",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN, WorkspaceRole.RESEARCHER),
  catchAsync(getResearchItemById)
);

export const ResearchRoutes = router;
export default router;

