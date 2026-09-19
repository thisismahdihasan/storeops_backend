import { Router } from "express";
import { WorkspaceRole } from "@prisma/client";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireWorkspaceRole } from "../../middleware/requireWorkspaceRole.js";
import { catchAsync } from "../../utils/catchAsync.js";
import {
  createWorkspace,
  deleteWorkspaceMember,
  getWorkspaceMembers,
  getUserWorkspaces,
  updateWorkspaceMemberAssignmentAvailability,
  updateWorkspaceMemberRoles,
  updateWorkspaceSettings,
} from "./workspace.controller.js";
import {
  createWorkspaceInvite,
  getPendingWorkspaceInvites,
  resendWorkspaceInvite,
  revokeWorkspaceInvite,
} from "../workspaceInvite/workspaceInvite.controller.js";
import { ResearchRoutes } from "../research/research.route.js";
import { DesignerRoutes, DesignRoutes } from "../designer/designer.route.js";
import { ReviewRoutes, AnnotationRoutes } from "../review/review.route.js";
import { ListerRoutes, ListingRoutes } from "../listing/listing.route.js";
import { DashboardRoutes } from "../dashboard/dashboard.route.js";
import { NotificationRoutes } from "../notification/notification.route.js";
import { StorageCleanupRoutes } from "../storage-cleanup/storageCleanup.route.js";

const router: Router = Router();

router.get("/", requireAuth, catchAsync(getUserWorkspaces));
router.post("/", requireAuth, catchAsync(createWorkspace));
router.patch(
  "/:workspaceId/settings",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(updateWorkspaceSettings)
);
router.post(
  "/:workspaceId/invites",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(createWorkspaceInvite)
);
router.get(
  "/:workspaceId/invites",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(getPendingWorkspaceInvites)
);
router.post(
  "/:workspaceId/invites/:inviteId/resend",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(resendWorkspaceInvite)
);
router.delete(
  "/:workspaceId/invites/:inviteId",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(revokeWorkspaceInvite)
);
router.get(
  "/:workspaceId/members",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(getWorkspaceMembers)
);
router.patch(
  "/:workspaceId/members/:userId/roles",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(updateWorkspaceMemberRoles)
);
router.patch(
  "/:workspaceId/members/:userId/assignment-availability",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(updateWorkspaceMemberAssignmentAvailability)
);
router.delete(
  "/:workspaceId/members/:userId",
  requireAuth,
  requireWorkspaceRole(WorkspaceRole.ADMIN),
  catchAsync(deleteWorkspaceMember)
);
router.use("/:workspaceId/research-items", ResearchRoutes);
router.use("/:workspaceId/designer", DesignerRoutes);
router.use("/:workspaceId/design", DesignRoutes);
router.use("/:workspaceId/reviews", ReviewRoutes);
router.use("/:workspaceId/annotations", AnnotationRoutes);
router.use("/:workspaceId/lister", ListerRoutes);
router.use("/:workspaceId/listing", ListingRoutes);
router.use("/:workspaceId/notifications", NotificationRoutes);
router.use("/:workspaceId/admin", DashboardRoutes);
router.use("/:workspaceId/admin/storage", StorageCleanupRoutes);

export const WorkspaceRoutes = router;
export default router;
