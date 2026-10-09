import { Request, Response } from "express";
import { AuthenticatedRequest } from "../../middleware/requireAuth.js";
import { ApiResponse } from "../../shared/ApiResponse.js";
import * as workspaceService from "./workspace.service.js";
import {
  createWorkspaceSchema,
  transferWorkspaceOwnershipSchema,
  updateWorkspaceMemberAssignmentAvailabilitySchema,
  updateWorkspaceMemberRolesSchema,
  workspaceIdParamsSchema,
  workspaceMemberParamsSchema,
} from "./workspace.validation.js";

// Creates a new workspace and automatically assigns the creator as an ADMIN member.
export const createWorkspace = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const validatedInput = createWorkspaceSchema.parse(req.body);

  const result = await workspaceService.createWorkspace(
    authReq.user.id,
    validatedInput
  );

  ApiResponse.success(res, {
    statusCode: 201,
    message: "Workspace created successfully",
    data: result,
  });
};

// Returns workspaces available to the authenticated user.
export const getUserWorkspaces = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const result = await workspaceService.getUserWorkspaces(authReq.user.id);

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Workspaces retrieved successfully",
    data: result,
  });
};

// Returns a safe, ordered team directory for workspace administrators.
export const getWorkspaceMembers = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { workspaceId } = workspaceIdParamsSchema.parse(req.params);
  const result = await workspaceService.getWorkspaceMembers(workspaceId);

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Workspace members retrieved successfully",
    data: result,
  });
};

// Replaces the target member's explicit workspace roles.
export const updateWorkspaceMemberRoles = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const { workspaceId, userId } = workspaceMemberParamsSchema.parse(req.params);
  const validatedInput = updateWorkspaceMemberRolesSchema.parse(req.body);
  const result = await workspaceService.updateWorkspaceMemberRoles(
    workspaceId,
    authReq.user.id,
    userId,
    validatedInput
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Workspace member roles updated successfully",
    data: result,
  });
};

// Updates a member's automatic Designer or Lister assignment availability.
export const updateWorkspaceMemberAssignmentAvailability = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const { workspaceId, userId } = workspaceMemberParamsSchema.parse(req.params);
  const validatedInput =
    updateWorkspaceMemberAssignmentAvailabilitySchema.parse(req.body);
  const result = await workspaceService.updateWorkspaceMemberAssignmentAvailability(
    workspaceId,
    authReq.user.id,
    userId,
    validatedInput
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Workspace member assignment availability updated successfully",
    data: result,
  });
};

// Deletes only the target workspace membership after safety invariants are checked.
export const deleteWorkspaceMember = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const { workspaceId, userId } = workspaceMemberParamsSchema.parse(req.params);
  const result = await workspaceService.deleteWorkspaceMember(
    workspaceId,
    authReq.user.id,
    userId
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Workspace member removed successfully",
    data: result,
  });
};

// Transfers workspace ownership to an existing workspace member.
export const transferWorkspaceOwnership = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const { workspaceId } = workspaceIdParamsSchema.parse(req.params);
  const validatedInput = transferWorkspaceOwnershipSchema.parse(req.body);
  const result = await workspaceService.transferWorkspaceOwnership(
    workspaceId,
    authReq.user.id,
    validatedInput
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Workspace ownership transferred successfully",
    data: result,
  });
};

import { updateWorkspaceSettingsSchema } from "./workspace.validation.js";

// Updates workspace-level auto assignment settings.
export const updateWorkspaceSettings = async (
  req: Request,
  res: Response
): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const { workspaceId } = workspaceIdParamsSchema.parse(req.params);
  const validatedInput = updateWorkspaceSettingsSchema.parse(req.body);

  const result = await workspaceService.updateWorkspaceSettings(
    workspaceId,
    authReq.user.id,
    validatedInput
  );

  ApiResponse.success(res, {
    statusCode: 200,
    message: "Workspace settings updated successfully",
    data: { workspace: result },
  });
};
