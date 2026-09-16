import { WorkspaceRole } from "@prisma/client";

export type SafeWorkspace = {
  id: string;
  name: string;
  ownerId: string;
  designerAutoAssignmentEnabled: boolean;
  listerAutoAssignmentEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type SafeWorkspaceMember = {
  id: string;
  workspaceId: string;
  userId: string;
  roles: WorkspaceRole[];
  createdAt: Date;
};

export type CreateWorkspaceResult = {
  workspace: SafeWorkspace;
  membership: SafeWorkspaceMember;
};

export type UserWorkspaceMembership = {
  id: string;
  roles: WorkspaceRole[];
  designerAssignmentEnabled: boolean;
  designerAssignmentPausedUntil: Date | null;
  listerAssignmentEnabled: boolean;
  listerAssignmentPausedUntil: Date | null;
  createdAt: Date;
};

export type UserWorkspace = SafeWorkspace & {
  membership: UserWorkspaceMembership;
};

export type GetUserWorkspacesResult = {
  workspaces: UserWorkspace[];
};

export type WorkspaceMemberListItem = {
  membershipId: string;
  userId: string;
  name: string | null;
  email: string;
  profileImageUrl: string | null;
  roles: WorkspaceRole[];
  designerAssignmentEnabled: boolean;
  designerAssignmentPausedUntil: Date | null;
  listerAssignmentEnabled: boolean;
  listerAssignmentPausedUntil: Date | null;
  joinedAt: Date;
};

export type GetWorkspaceMembersResult = {
  members: WorkspaceMemberListItem[];
};

export type UpdateWorkspaceMemberRolesResult = {
  member: WorkspaceMemberListItem;
};

export type UpdateWorkspaceMemberAssignmentAvailabilityResult = {
  member: WorkspaceMemberListItem;
};

export type DeleteWorkspaceMemberResult = {
  userId: string;
};
