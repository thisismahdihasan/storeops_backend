import { Prisma, WorkspaceRole } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import { ApiError } from "../../shared/ApiError.js";
import { ACTIVE_LISTING_WORKLOAD_STATUSES } from "../listing/listing.assignment.js";
import { ACTIVE_DESIGN_STATUSES } from "../research/research.assignment.js";
import { acquireWorkspaceMemberMutationLock } from "./workspace.member-lock.js";
import {
  CreateWorkspaceInput,
  UpdateWorkspaceMemberAssignmentAvailabilityInput,
  UpdateWorkspaceMemberRolesInput,
} from "./workspace.validation.js";
import {
  CreateWorkspaceResult,
  DeleteWorkspaceMemberResult,
  GetWorkspaceMembersResult,
  GetUserWorkspacesResult,
  UpdateWorkspaceMemberAssignmentAvailabilityResult,
  UpdateWorkspaceMemberRolesResult,
} from "./workspace.type.js";

const safeWorkspaceSelect = {
  id: true,
  name: true,
  ownerId: true,
  designerAutoAssignmentEnabled: true,
  listerAutoAssignmentEnabled: true,
  finalAssetAutoCleanupEnabled: true,
  finalAssetRetentionDays: true,
  createdAt: true,
  updatedAt: true,
} as const;

const safeWorkspaceMemberSelect = {
  id: true,
  workspaceId: true,
  userId: true,
  roles: true,
  createdAt: true,
} as const;

const safeWorkspaceMemberListSelect = {
  id: true,
  userId: true,
  roles: true,
  designerAssignmentEnabled: true,
  designerAssignmentPausedUntil: true,
  listerAssignmentEnabled: true,
  listerAssignmentPausedUntil: true,
  createdAt: true,
  user: {
    select: {
      name: true,
      email: true,
      profileImageUrl: true,
    },
  },
} as const;

const toWorkspaceMemberListItem = (membership: {
  id: string;
  userId: string;
  roles: WorkspaceRole[];
  designerAssignmentEnabled: boolean;
  designerAssignmentPausedUntil: Date | null;
  listerAssignmentEnabled: boolean;
  listerAssignmentPausedUntil: Date | null;
  createdAt: Date;
  user: { name: string | null; email: string; profileImageUrl: string | null };
}) => ({
  membershipId: membership.id,
  userId: membership.userId,
  name: membership.user.name,
  email: membership.user.email,
  profileImageUrl: membership.user.profileImageUrl,
  roles: membership.roles,
  designerAssignmentEnabled: membership.designerAssignmentEnabled,
  designerAssignmentPausedUntil: membership.designerAssignmentPausedUntil,
  listerAssignmentEnabled: membership.listerAssignmentEnabled,
  listerAssignmentPausedUntil: membership.listerAssignmentPausedUntil,
  joinedAt: membership.createdAt,
});

const assertCurrentActorIsAdmin = async (
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actorUserId: string
): Promise<void> => {
  const actorMembership = await tx.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: actorUserId,
      },
    },
    select: { roles: true },
  });

  if (!actorMembership?.roles.includes(WorkspaceRole.ADMIN)) {
    throw new ApiError(403, "Insufficient workspace permissions");
  }
};

const assertWorkspaceRetainsAdmin = async (
  tx: Prisma.TransactionClient,
  workspaceId: string
): Promise<void> => {
  const adminCount = await tx.workspaceMember.count({
    where: {
      workspaceId,
      roles: { has: WorkspaceRole.ADMIN },
    },
  });

  if (adminCount <= 1) {
    throw new ApiError(409, "Workspace must retain at least one Admin.");
  }
};

const assertNoActiveDesignerWork = async (
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string
): Promise<void> => {
  const activeAssignment = await tx.designAssignment.findFirst({
    where: {
      designerId: userId,
      isCurrent: true,
      researchItem: {
        workspaceId,
        status: { in: ACTIVE_DESIGN_STATUSES },
      },
    },
    select: { id: true },
  });

  if (activeAssignment) {
    throw new ApiError(
      409,
      "Reassign active design work before removing the DESIGNER role."
    );
  }
};

const assertNoActiveListerWork = async (
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string
): Promise<void> => {
  const activeAssignment = await tx.listingAssignment.findFirst({
    where: {
      listerId: userId,
      isCurrent: true,
      researchItem: {
        workspaceId,
        status: { in: ACTIVE_LISTING_WORKLOAD_STATUSES },
      },
    },
    select: { id: true },
  });

  if (activeAssignment) {
    throw new ApiError(
      409,
      "Reassign or complete active listing work before removing the LISTER role."
    );
  }
};

// Creates a new workspace and sets up the owner as an initial ADMIN member within a transaction.
export const createWorkspace = async (
  userId: string,
  input: CreateWorkspaceInput
): Promise<CreateWorkspaceResult> => {
  const existingWorkspace = await prisma.workspace.findUnique({
    where: { ownerId: userId },
    select: { id: true },
  });

  if (existingWorkspace) {
    throw new ApiError(409, "User already owns a workspace");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: input.name,
          ownerId: userId,
        },
        select: safeWorkspaceSelect,
      });

      const membership = await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId,
          roles: [WorkspaceRole.ADMIN],
        },
        select: safeWorkspaceMemberSelect,
      });

      return {
        workspace,
        membership,
      };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ApiError(409, "User already owns a workspace");
    }
    throw error;
  }
};

// Returns the authenticated user's workspace memberships for session restoration and workspace selection.
export const getUserWorkspaces = async (
  userId: string
): Promise<GetUserWorkspacesResult> => {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId },
    select: {
      id: true,
      roles: true,
      designerAssignmentEnabled: true,
      designerAssignmentPausedUntil: true,
      listerAssignmentEnabled: true,
      listerAssignmentPausedUntil: true,
      createdAt: true,
      workspace: {
        select: safeWorkspaceSelect,
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return {
    workspaces: memberships.map((membership) => ({
      ...membership.workspace,
      membership: {
        id: membership.id,
        roles: membership.roles,
        designerAssignmentEnabled: membership.designerAssignmentEnabled,
        designerAssignmentPausedUntil: membership.designerAssignmentPausedUntil,
        listerAssignmentEnabled: membership.listerAssignmentEnabled,
        listerAssignmentPausedUntil: membership.listerAssignmentPausedUntil,
        createdAt: membership.createdAt,
      },
    })),
  };
};

// Returns safe workspace membership data for the admin team directory.
export const getWorkspaceMembers = async (
  workspaceId: string
): Promise<GetWorkspaceMembersResult> => {
  const memberships = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: {
      id: true,
      userId: true,
      roles: true,
      designerAssignmentEnabled: true,
      designerAssignmentPausedUntil: true,
      listerAssignmentEnabled: true,
      listerAssignmentPausedUntil: true,
      createdAt: true,
      user: {
        select: {
          name: true,
          email: true,
          profileImageUrl: true,
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  return {
    members: memberships.map(toWorkspaceMemberListItem),
  };
};

// Replaces a workspace member's explicit role set after preserving workspace safety invariants.
export const updateWorkspaceMemberRoles = async (
  workspaceId: string,
  actorUserId: string,
  targetUserId: string,
  input: UpdateWorkspaceMemberRolesInput
): Promise<UpdateWorkspaceMemberRolesResult> => {
  return await prisma.$transaction(async (tx) => {
    await acquireWorkspaceMemberMutationLock(tx, workspaceId);
    await assertCurrentActorIsAdmin(tx, workspaceId, actorUserId);

    const targetMembership = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: targetUserId,
        },
      },
      select: safeWorkspaceMemberListSelect,
    });

    if (!targetMembership) {
      throw new ApiError(404, "Workspace member not found");
    }

    const removedRoles = targetMembership.roles.filter(
      (role) => !input.roles.includes(role)
    );

    if (removedRoles.includes(WorkspaceRole.ADMIN)) {
      await assertWorkspaceRetainsAdmin(tx, workspaceId);
    }

    if (removedRoles.includes(WorkspaceRole.DESIGNER)) {
      await assertNoActiveDesignerWork(tx, workspaceId, targetUserId);
    }

    if (removedRoles.includes(WorkspaceRole.LISTER)) {
      await assertNoActiveListerWork(tx, workspaceId, targetUserId);
    }

    const designerRoleChanged =
      targetMembership.roles.includes(WorkspaceRole.DESIGNER) !==
      input.roles.includes(WorkspaceRole.DESIGNER);
    const listerRoleChanged =
      targetMembership.roles.includes(WorkspaceRole.LISTER) !==
      input.roles.includes(WorkspaceRole.LISTER);

    const updatedMembership = await tx.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: targetUserId,
        },
      },
      data: {
        roles: input.roles,
        ...(designerRoleChanged
          ? {
              designerAssignmentEnabled: true,
              designerAssignmentPausedUntil: null,
            }
          : {}),
        ...(listerRoleChanged
          ? {
              listerAssignmentEnabled: true,
              listerAssignmentPausedUntil: null,
            }
          : {}),
      },
      select: safeWorkspaceMemberListSelect,
    });

    return { member: toWorkspaceMemberListItem(updatedMembership) };
  });
};

// Updates one role's automatic assignment availability without changing any role membership.
export const updateWorkspaceMemberAssignmentAvailability = async (
  workspaceId: string,
  actorUserId: string,
  targetUserId: string,
  input: UpdateWorkspaceMemberAssignmentAvailabilityInput
): Promise<UpdateWorkspaceMemberAssignmentAvailabilityResult> => {
  return await prisma.$transaction(async (tx) => {
    await acquireWorkspaceMemberMutationLock(tx, workspaceId);
    await assertCurrentActorIsAdmin(tx, workspaceId, actorUserId);

    const targetMembership = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: targetUserId,
        },
      },
      select: { roles: true },
    });

    if (!targetMembership) {
      throw new ApiError(404, "Workspace member not found");
    }

    if (!targetMembership.roles.includes(input.role)) {
      throw new ApiError(400, "Member does not have the selected workspace role");
    }

    const pausedUntil =
      input.mode === "PAUSED" ? new Date(input.pausedUntil!) : null;
    const availabilityUpdate =
      input.role === WorkspaceRole.DESIGNER
        ? {
            designerAssignmentEnabled: input.mode !== "OFF",
            designerAssignmentPausedUntil: pausedUntil,
          }
        : {
            listerAssignmentEnabled: input.mode !== "OFF",
            listerAssignmentPausedUntil: pausedUntil,
          };

    const updatedMembership = await tx.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: targetUserId,
        },
      },
      data: availabilityUpdate,
      select: safeWorkspaceMemberListSelect,
    });

    return { member: toWorkspaceMemberListItem(updatedMembership) };
  });
};

// Removes a workspace membership while retaining user-owned workflow and audit history.
export const deleteWorkspaceMember = async (
  workspaceId: string,
  actorUserId: string,
  targetUserId: string
): Promise<DeleteWorkspaceMemberResult> => {
  return await prisma.$transaction(async (tx) => {
    await acquireWorkspaceMemberMutationLock(tx, workspaceId);
    await assertCurrentActorIsAdmin(tx, workspaceId, actorUserId);

    const targetMembership = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: targetUserId,
        },
      },
      select: { roles: true },
    });

    if (!targetMembership) {
      throw new ApiError(404, "Workspace member not found");
    }

    if (targetMembership.roles.includes(WorkspaceRole.ADMIN)) {
      await assertWorkspaceRetainsAdmin(tx, workspaceId);
    }

    if (targetMembership.roles.includes(WorkspaceRole.DESIGNER)) {
      await assertNoActiveDesignerWork(tx, workspaceId, targetUserId);
    }

    if (targetMembership.roles.includes(WorkspaceRole.LISTER)) {
      await assertNoActiveListerWork(tx, workspaceId, targetUserId);
    }

    await tx.workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: targetUserId,
        },
      },
    });

    return { userId: targetUserId };
  });
};

import { UpdateWorkspaceSettingsInput } from "./workspace.validation.js";
import { SafeWorkspace } from "./workspace.type.js";

// Updates workspace-level assignment settings.
export const updateWorkspaceSettings = async (
  workspaceId: string,
  actorUserId: string,
  input: UpdateWorkspaceSettingsInput
): Promise<SafeWorkspace> => {
  return await prisma.$transaction(async (tx) => {
    // Acquire the same advisory lock used for auto assignment routing
    await acquireWorkspaceMemberMutationLock(tx, workspaceId);
    
    await assertCurrentActorIsAdmin(tx, workspaceId, actorUserId);

    const updatedWorkspace = await tx.workspace.update({
      where: { id: workspaceId },
      data: {
        ...(input.designerAutoAssignmentEnabled !== undefined
          ? { designerAutoAssignmentEnabled: input.designerAutoAssignmentEnabled }
          : {}),
        ...(input.listerAutoAssignmentEnabled !== undefined
          ? { listerAutoAssignmentEnabled: input.listerAutoAssignmentEnabled }
          : {}),
        ...(input.finalAssetAutoCleanupEnabled !== undefined
          ? { finalAssetAutoCleanupEnabled: input.finalAssetAutoCleanupEnabled }
          : {}),
        ...(input.finalAssetRetentionDays !== undefined
          ? { finalAssetRetentionDays: input.finalAssetRetentionDays }
          : {}),
      },
      select: safeWorkspaceSelect,
    });

    return updatedWorkspace;
  });
};
