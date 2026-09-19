import { z } from "zod";

const workspaceIdSchema = z.string().trim().min(1, "workspaceId is required");

export const storageCleanupFilterSchema = z.enum([
  "ELIGIBLE",
  "CLEANED",
  "ALL",
]);

export const getStorageCleanupCandidatesQuerySchema = z
  .object({
    page: z.coerce
      .number()
      .int("page must be an integer")
      .positive("page must be a positive integer")
      .default(1),
    limit: z.coerce
      .number()
      .int("limit must be an integer")
      .positive("limit must be a positive integer")
      .max(100, "limit cannot exceed 100")
      .default(20),
    search: z
      .string()
      .trim()
      .max(100, "search cannot exceed 100 characters")
      .transform((value) => (value.length > 0 ? value : undefined))
      .optional(),
    filter: storageCleanupFilterSchema.default("ELIGIBLE"),
  })
  .strict();

export type GetStorageCleanupCandidatesQueryInput = z.infer<
  typeof getStorageCleanupCandidatesQuerySchema
>;

export const storageCleanupWorkspaceParamsSchema = z
  .object({
    workspaceId: workspaceIdSchema,
  })
  .strict();

export const storageCleanupFinalAssetParamsSchema =
  storageCleanupWorkspaceParamsSchema
    .extend({
      finalAssetId: z.string().trim().min(1, "finalAssetId is required"),
    })
    .strict();

export const bulkCleanupFinalAssetsBodySchema = z
  .object({
    finalAssetIds: z
      .array(
        z
          .string({ message: "final asset ID is required" })
          .trim()
          .min(1, "final asset ID is required")
      )
      .min(1, "At least one final asset ID is required")
      .max(100, "Cannot clean more than 100 final assets at once")
      .transform((finalAssetIds) => [...new Set(finalAssetIds)]),
  })
  .strict();

export type BulkCleanupFinalAssetsBodyInput = z.infer<
  typeof bulkCleanupFinalAssetsBodySchema
>;
