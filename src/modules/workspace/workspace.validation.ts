import { WorkspaceRole } from "@prisma/client";
import { z } from "zod";

export const createWorkspaceSchema = z.object({
  name: z
    .string({ message: "Workspace name is required" })
    .trim()
    .min(1, "Workspace name cannot be empty")
    .max(100, "Workspace name must be at most 100 characters long"),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const workspaceIdParamsSchema = z.object({
  workspaceId: z.string().trim().min(1, "Workspace ID is required"),
}).strict();

export const workspaceMemberParamsSchema = workspaceIdParamsSchema.extend({
  userId: z.string().trim().min(1, "User ID is required"),
}).strict();

export const updateWorkspaceMemberRolesSchema = z.object({
  roles: z
    .array(z.enum(WorkspaceRole))
    .min(1, "At least one workspace role is required")
    .refine(
      (roles) => new Set(roles).size === roles.length,
      "Workspace roles must be unique"
    ),
}).strict();

export type UpdateWorkspaceMemberRolesInput = z.infer<
  typeof updateWorkspaceMemberRolesSchema
>;

export const assignmentAvailabilityRoleSchema = z.enum([
  WorkspaceRole.DESIGNER,
  WorkspaceRole.LISTER,
]);

export const assignmentAvailabilityModeSchema = z.enum([
  "AVAILABLE",
  "PAUSED",
  "OFF",
]);

export const updateWorkspaceMemberAssignmentAvailabilitySchema = z
  .object({
    role: assignmentAvailabilityRoleSchema,
    mode: assignmentAvailabilityModeSchema,
    pausedUntil: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "PAUSED") {
      if (!value.pausedUntil) {
        context.addIssue({
          code: "custom",
          path: ["pausedUntil"],
          message: "pausedUntil is required when mode is PAUSED",
        });
        return;
      }

      if (new Date(value.pausedUntil).getTime() <= Date.now()) {
        context.addIssue({
          code: "custom",
          path: ["pausedUntil"],
          message: "pausedUntil must be in the future",
        });
      }
      return;
    }

    if (value.pausedUntil) {
      context.addIssue({
        code: "custom",
        path: ["pausedUntil"],
        message: "pausedUntil is only allowed when mode is PAUSED",
      });
    }
  });

export type UpdateWorkspaceMemberAssignmentAvailabilityInput = z.infer<
  typeof updateWorkspaceMemberAssignmentAvailabilitySchema
>;

export const updateWorkspaceSettingsSchema = z
  .object({
    designerAutoAssignmentEnabled: z.boolean().optional(),
    listerAutoAssignmentEnabled: z.boolean().optional(),
    finalAssetAutoCleanupEnabled: z.boolean().optional(),
    finalAssetRetentionDays: z.number().int().min(1).max(365).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.designerAutoAssignmentEnabled !== undefined ||
      data.listerAutoAssignmentEnabled !== undefined ||
      data.finalAssetAutoCleanupEnabled !== undefined ||
      data.finalAssetRetentionDays !== undefined,
    "At least one setting must be provided"
  );

export type UpdateWorkspaceSettingsInput = z.infer<
  typeof updateWorkspaceSettingsSchema
>;
