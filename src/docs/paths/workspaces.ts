import { jsonError, jsonSuccess } from "../components.js";
import { OpenApiPathMap } from "../docs.type.js";

const inviteBody = {
  type: "object", additionalProperties: false, required: ["email", "roles"],
  properties: {
    email: { type: "string", format: "email" },
    roles: { type: "array", minItems: 1, uniqueItems: true, items: { $ref: "#/components/schemas/WorkspaceRole" } },
  },
};

const inviteData = {
  type: "object", required: ["invite"], properties: {
    invite: { type: "object", required: ["id", "workspaceId", "email", "roles", "expiresAt", "createdAt", "lastSentAt"], properties: {
      id: { type: "string" }, workspaceId: { type: "string" }, email: { type: "string", format: "email" },
      roles: { type: "array", items: { $ref: "#/components/schemas/WorkspaceRole" } },
      expiresAt: { type: "string", format: "date-time" }, createdAt: { type: "string", format: "date-time" }, lastSentAt: { type: "string", format: "date-time" },
    } },
  },
};

const pendingInviteData = {
  type: "object", required: ["invites"], properties: {
    invites: { type: "array", items: { type: "object", required: ["id", "email", "roles", "createdAt", "expiresAt", "acceptedAt", "lastSentAt", "status"], properties: {
      id: { type: "string" }, email: { type: "string", format: "email" },
      roles: { type: "array", items: { $ref: "#/components/schemas/WorkspaceRole" } },
      createdAt: { type: "string", format: "date-time" }, expiresAt: { type: "string", format: "date-time" },
      acceptedAt: { type: "string", format: "date-time", nullable: true }, lastSentAt: { type: "string", format: "date-time", nullable: true },
      status: { type: "string", enum: ["PENDING", "EXPIRED"] },
    } } },
  },
};

const workspaceMemberData = {
  type: "object",
  required: ["membershipId", "userId", "name", "email", "profileImageUrl", "roles", "designerAssignmentEnabled", "designerAssignmentPausedUntil", "listerAssignmentEnabled", "listerAssignmentPausedUntil", "joinedAt"],
  properties: {
    membershipId: { type: "string" },
    userId: { type: "string" },
    name: { type: "string", nullable: true },
    email: { type: "string", format: "email" },
    profileImageUrl: { type: "string", format: "uri", nullable: true },
    roles: { type: "array", items: { $ref: "#/components/schemas/WorkspaceRole" } },
    designerAssignmentEnabled: { type: "boolean" },
    designerAssignmentPausedUntil: { type: "string", format: "date-time", nullable: true },
    listerAssignmentEnabled: { type: "boolean" },
    listerAssignmentPausedUntil: { type: "string", format: "date-time", nullable: true },
    joinedAt: { type: "string", format: "date-time" },
  },
};

const workspaceMemberRolesBody = {
  type: "object",
  additionalProperties: false,
  required: ["roles"],
  properties: {
    roles: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { $ref: "#/components/schemas/WorkspaceRole" },
    },
  },
};

const workspaceMemberAssignmentAvailabilityBody = {
  type: "object",
  additionalProperties: false,
  required: ["role", "mode"],
  properties: {
    role: { type: "string", enum: ["DESIGNER", "LISTER"] },
    mode: { type: "string", enum: ["AVAILABLE", "PAUSED", "OFF"] },
    pausedUntil: {
      type: "string",
      format: "date-time",
      description: "Required and strictly in the future when mode is PAUSED; omitted for AVAILABLE and OFF.",
    },
  },
};

export const workspacePaths: OpenApiPathMap = {
  "/api/v1/workspaces": {
    get: {
      tags: ["Workspaces"], summary: "List workspaces available to the current user",
      description: "Returns the authenticated user's explicit memberships for workspace and role restoration. Users with no memberships receive an empty workspaces array.",
      security: [{ cookieAuth: [] }],
      responses: {
        "200": jsonSuccess("Workspaces retrieved successfully.", {
          type: "object", required: ["workspaces"], properties: {
            workspaces: { type: "array", items: { type: "object", required: ["id", "name", "ownerId", "createdAt", "updatedAt", "membership"], properties: {
              id: { type: "string" }, name: { type: "string" }, ownerId: { type: "string" },
              createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
              membership: { type: "object", required: ["id", "roles", "createdAt"], properties: {
                id: { type: "string" }, roles: { type: "array", items: { $ref: "#/components/schemas/WorkspaceRole" } }, createdAt: { type: "string", format: "date-time" },
              } },
            } } },
          },
        }),
        "401": jsonError("Authentication is required."),
      },
    },
    post: {
      tags: ["Workspaces"], summary: "Create a workspace", security: [{ cookieAuth: [] }],
      requestBody: { required: true, content: { "application/json": { schema: {
        type: "object", additionalProperties: false, required: ["name"],
        properties: { name: { type: "string", minLength: 1, maxLength: 100 } },
      } } } },
      responses: {
        "201": jsonSuccess("Workspace created successfully.", { type: "object", required: ["workspace", "membership"], properties: {
          workspace: { $ref: "#/components/schemas/Workspace" },
          membership: { $ref: "#/components/schemas/WorkspaceMembership" },
        } }),
        "400": jsonError("Invalid workspace body."), "401": jsonError("Authentication is required."),
        "409": jsonError("The user already owns a workspace."),
      },
    },
  },
  "/api/v1/workspace/invites": {
    post: {
      tags: ["Invites"], summary: "Create an invite for the caller's resolved admin workspace",
      description: "Fails when the caller administers multiple workspaces; use the workspace-scoped route instead.",
      security: [{ cookieAuth: [] }], requestBody: { required: true, content: { "application/json": { schema: inviteBody } } },
      responses: { "201": jsonSuccess("Invite created and submitted to the mail server successfully.", inviteData), "400": jsonError("Invalid invite body or ambiguous workspace."), "401": jsonError("Authentication is required."), "403": jsonError("Caller is not a workspace admin."), "409": jsonError("Member or active invite already exists."), "500": jsonError("Invitation email delivery failed.") },
    },
  },
  "/api/v1/workspace/invites/{token}/accept": {
    post: {
      tags: ["Invites"], summary: "Accept an emailed workspace invitation", security: [{ cookieAuth: [] }],
      parameters: [{ name: "token", in: "path", required: true, schema: { type: "string", minLength: 1 } }],
      responses: { "200": jsonSuccess("Invitation accepted successfully.", { type: "object", required: ["membership", "workspace", "invite"], properties: {
        membership: { $ref: "#/components/schemas/WorkspaceMembership" }, workspace: { $ref: "#/components/schemas/WorkspaceSummary" },
        invite: { type: "object", required: ["id", "acceptedAt"], properties: { id: { type: "string" }, acceptedAt: { type: "string", format: "date-time", nullable: true } } },
      } }), "400": jsonError("Invalid invitation."), "401": jsonError("Authentication is required."), "403": jsonError("Invitation belongs to another email."), "409": jsonError("Invitation was accepted or user is already a member."), "410": jsonError("Invitation expired.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/invites": {
    get: {
      tags: ["Invites"], summary: "List unaccepted workspace invitations",
      description: "ADMIN only. Returns unaccepted invitations in newest-first order. `status=pending` is supported; status is derived as PENDING or EXPIRED. Tokens and SMTP evidence are never exposed.",
      security: [{ cookieAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/WorkspaceId" }, { name: "status", in: "query", required: false, schema: { type: "string", enum: ["pending"] } }],
      responses: { "200": jsonSuccess("Pending workspace invitations retrieved successfully.", pendingInviteData), "400": jsonError("Invalid invite query."), "401": jsonError("Authentication is required."), "403": jsonError("Explicit ADMIN role is required.") },
    },
    post: {
      tags: ["Invites"], summary: "Create a workspace-scoped invitation", security: [{ cookieAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/WorkspaceId" }], requestBody: { required: true, content: { "application/json": { schema: inviteBody } } },
      responses: { "201": jsonSuccess("Invite created and submitted to the mail server successfully.", inviteData), "400": jsonError("Invalid invite body."), "401": jsonError("Authentication is required."), "403": jsonError("Explicit ADMIN role is required."), "409": jsonError("Member or active invite already exists."), "502": jsonError("Invitation mail provider did not complete the request, or submission could not be finalized.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/invites/{inviteId}/resend": {
    post: {
      tags: ["Invites"], summary: "Resend a workspace invitation",
      description: "ADMIN only. Resends an unaccepted active or expired invitation after a five-minute cooldown. Each successful resend rotates the token and resets link expiry to 24 hours. Tokens and mail-provider evidence are never exposed.",
      security: [{ cookieAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/WorkspaceId" }, { name: "inviteId", in: "path", required: true, schema: { type: "string", minLength: 1 } }],
      responses: { "200": jsonSuccess("Workspace invitation resent successfully.", inviteData), "401": jsonError("Authentication is required."), "403": jsonError("Explicit ADMIN role is required."), "404": jsonError("Workspace invitation was not found."), "409": jsonError("Accepted invitation or changed invite state."), "429": jsonError("Invite resend cooldown is active. `data.retryAfterSeconds` is returned."), "502": jsonError("Invitation mail submission failed or could not be finalized.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/invites/{inviteId}": {
    delete: {
      tags: ["Invites"], summary: "Revoke an unaccepted workspace invitation",
      description: "ADMIN only. Active and expired unaccepted invitations may be deleted. Accepted invitations return 409. Revocation invalidates the old token.",
      security: [{ cookieAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/WorkspaceId" }, { name: "inviteId", in: "path", required: true, schema: { type: "string", minLength: 1 } }],
      responses: { "200": jsonSuccess("Workspace invitation revoked successfully.", { type: "object", required: ["inviteId"], properties: { inviteId: { type: "string" } } }), "401": jsonError("Authentication is required."), "403": jsonError("Explicit ADMIN role is required."), "404": jsonError("Workspace invitation was not found."), "409": jsonError("Accepted invitation or changed invite state.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/members": {
    get: {
      tags: ["Workspaces"],
      summary: "List workspace members",
      description: "ADMIN only. Returns safe membership data for the team directory in joined-date order.",
      security: [{ cookieAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/WorkspaceId" }],
      responses: {
        "200": jsonSuccess("Workspace members retrieved successfully.", {
          type: "object",
          required: ["members"],
          properties: {
            members: {
              type: "array",
              items: workspaceMemberData,
            },
          },
        }),
        "401": jsonError("Authentication is required."),
        "403": jsonError("Explicit ADMIN role is required."),
      },
    },
  },
  "/api/v1/workspaces/{workspaceId}/members/{userId}/roles": {
    patch: {
      tags: ["Workspaces"],
      summary: "Replace a workspace member's roles",
      description: "ADMIN only. Replaces the member's explicit role array and blocks removal of the last Admin or a role with active assigned work.",
      security: [{ cookieAuth: [] }],
      parameters: [
        { $ref: "#/components/parameters/WorkspaceId" },
        { name: "userId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      requestBody: { required: true, content: { "application/json": { schema: workspaceMemberRolesBody } } },
      responses: {
        "200": jsonSuccess("Workspace member roles updated successfully", { type: "object", required: ["member"], properties: { member: workspaceMemberData } }),
        "400": jsonError("Invalid member parameters or roles body."),
        "401": jsonError("Authentication is required."),
        "403": jsonError("Explicit ADMIN role is required."),
        "404": jsonError("Workspace member not found"),
        "409": jsonError("Workspace must retain at least one Admin. Reassign active design work before removing the DESIGNER role. Reassign or complete active listing work before removing the LISTER role."),
      },
    },
  },
  "/api/v1/workspaces/{workspaceId}/members/{userId}/assignment-availability": {
    patch: {
      tags: ["Workspaces"],
      summary: "Set a member's automatic assignment availability",
      description: "ADMIN only. Applies to the member's existing DESIGNER or LISTER role. AVAILABLE enables automatic assignment, PAUSED enables it after the future pausedUntil time, and OFF disables it. Manual designer reassignment remains role-based and is unaffected.",
      security: [{ cookieAuth: [] }],
      parameters: [
        { $ref: "#/components/parameters/WorkspaceId" },
        { name: "userId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      requestBody: { required: true, content: { "application/json": { schema: workspaceMemberAssignmentAvailabilityBody } } },
      responses: {
        "200": jsonSuccess("Workspace member assignment availability updated successfully", { type: "object", required: ["member"], properties: { member: workspaceMemberData } }),
        "400": jsonError("Invalid member parameters, assignment availability body, or selected role."),
        "401": jsonError("Authentication is required."),
        "403": jsonError("Explicit ADMIN role is required."),
        "404": jsonError("Workspace member not found."),
      },
    },
  },
  "/api/v1/workspaces/{workspaceId}/members/{userId}": {
    delete: {
      tags: ["Workspaces"],
      summary: "Remove a workspace member",
      description: "ADMIN only. Deletes only the WorkspaceMember row; user-owned workflow and audit history remains intact. Blocks removal of the last Admin or a member with active Designer/Lister work.",
      security: [{ cookieAuth: [] }],
      parameters: [
        { $ref: "#/components/parameters/WorkspaceId" },
        { name: "userId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      responses: {
        "200": jsonSuccess("Workspace member removed successfully", { type: "object", required: ["userId"], properties: { userId: { type: "string" } } }),
        "400": jsonError("Invalid member parameters."),
        "401": jsonError("Authentication is required."),
        "403": jsonError("Explicit ADMIN role is required."),
        "404": jsonError("Workspace member not found"),
        "409": jsonError("Workspace must retain at least one Admin. Reassign active design work before removing the DESIGNER role. Reassign or complete active listing work before removing the LISTER role."),
      },
    },
  },
  "/api/v1/workspaces/{workspaceId}/settings": {
    patch: {
      tags: ["Workspaces"], summary: "Update workspace settings",
      description: "ADMIN only. Updates workspace-level settings like auto-assignment toggles.",
      security: [{ cookieAuth: [] }],
      parameters: [{ $ref: "#/components/parameters/WorkspaceId" }],
      requestBody: { required: true, content: { "application/json": { schema: {
        type: "object", additionalProperties: false, properties: {
          designerAutoAssignmentEnabled: { type: "boolean" },
          listerAutoAssignmentEnabled: { type: "boolean" },
        }
      } } } },
      responses: {
        "200": jsonSuccess("Workspace settings updated successfully", { type: "object", required: ["workspace"], properties: { workspace: { $ref: "#/components/schemas/WorkspaceSummary" } } }),
        "400": jsonError("Invalid settings body."),
        "401": jsonError("Authentication is required."),
        "403": jsonError("Explicit ADMIN role is required."),
      },
    },
  },
};
