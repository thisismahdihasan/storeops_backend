import { z } from "zod";
import { ResearchStatus } from "@prisma/client";

export const LISTER_QUEUE_ACTIVE_STATUSES = [
  ResearchStatus.READY_FOR_LISTING,
  ResearchStatus.LISTING_IN_PROGRESS,
] as const;

export type ListerQueueActiveStatus =
  (typeof LISTER_QUEUE_ACTIVE_STATUSES)[number];

export const getListerWorkQueueQuerySchema = z
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
    status: z
      .nativeEnum(ResearchStatus, {
        message: "Invalid status filter",
      })
      .refine(
        (val): val is ListerQueueActiveStatus =>
          (LISTER_QUEUE_ACTIVE_STATUSES as readonly ResearchStatus[]).includes(
            val
          ),
        {
          message:
            "Invalid status filter. Allowed values: READY_FOR_LISTING, LISTING_IN_PROGRESS",
        }
      )
      .optional(),
    search: z
      .string()
      .trim()
      .max(100, "search cannot exceed 100 characters")
      .transform((val) => (val.length > 0 ? val : undefined))
      .optional(),
    sort: z.enum(["fifo", "newest"]).optional(),
  })
  .strict();

export type GetListerWorkQueueQueryInput = z.infer<
  typeof getListerWorkQueueQuerySchema
>;

export const ADMIN_LISTING_WORKFLOW_STATUSES = [
  ResearchStatus.READY_FOR_LISTING,
  ResearchStatus.LISTING_IN_PROGRESS,
  ResearchStatus.LISTED,
] as const;

export type AdminListingWorkflowStatus =
  (typeof ADMIN_LISTING_WORKFLOW_STATUSES)[number];

export const getAdminListingListQuerySchema = z
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
    listerId: z.string().trim().min(1, "listerId cannot be empty").optional(),
    status: z
      .nativeEnum(ResearchStatus, {
        message: "Invalid status filter",
      })
      .refine(
        (val): val is AdminListingWorkflowStatus =>
          (ADMIN_LISTING_WORKFLOW_STATUSES as readonly ResearchStatus[]).includes(val),
        {
          message:
            "Invalid listing status filter. Allowed values: READY_FOR_LISTING, LISTING_IN_PROGRESS, LISTED",
        }
      )
      .optional(),
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format, expected YYYY-MM-DD")
      .refine((val) => {
        const parts = val.split("-").map(Number);
        if (parts.length !== 3 || parts.some(isNaN)) return false;
        const [year, month, day] = parts;
        const d = new Date(Date.UTC(year, month - 1, day));
        return (
          d.getUTCFullYear() === year &&
          d.getUTCMonth() === month - 1 &&
          d.getUTCDate() === day
        );
      }, "Invalid calendar date")
      .optional(),
    search: z
      .string()
      .trim()
      .max(100, "search cannot exceed 100 characters")
      .transform((val) => (val.length > 0 ? val : undefined))
      .optional(),
    assignment: z.enum(["UNASSIGNED"]).optional(),
    sort: z.enum(["updated", "newest", "oldest"]).optional(),
  })
  .strict();

export type GetAdminListingListQueryInput = z.infer<
  typeof getAdminListingListQuerySchema
>;

export const assignListerBodySchema = z
  .object({
    listerId: z
      .string({ message: "listerId is required" })
      .trim()
      .min(1, "listerId is required"),
  })
  .strict();

export type AssignListerBodyInput = z.infer<typeof assignListerBodySchema>;

const bulkListingItemIdsSchema = z
  .array(
    z
      .string({ message: "research item ID is required" })
      .trim()
      .min(1, "research item ID is required")
  )
  .min(1, "At least one research item ID is required")
  .max(100, "Cannot assign more than 100 research items at once")
  .superRefine((researchItemIds, ctx) => {
    if (new Set(researchItemIds).size !== researchItemIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "researchItemIds must not contain duplicates",
      });
    }
  });

export const bulkAssignListingBodySchema = z.discriminatedUnion("mode", [
  z
    .object({
      researchItemIds: bulkListingItemIdsSchema,
      mode: z.literal("TARGET"),
      listerId: z
        .string({ message: "listerId is required" })
        .trim()
        .min(1, "listerId is required"),
    })
    .strict(),
  z
    .object({
      researchItemIds: bulkListingItemIdsSchema,
      mode: z.literal("DISTRIBUTE"),
    })
    .strict(),
]);

export type BulkAssignListingBodyInput = z.infer<
  typeof bulkAssignListingBodySchema
>;

export const getListerListingDetailParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    researchItemId: z.string().trim().min(1, "researchItemId is required"),
  })
  .strict();

export type GetListerListingDetailParamsInput = z.infer<
  typeof getListerListingDetailParamsSchema
>;

export const backfillListingAssignmentsParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
  })
  .strict();

export type BackfillListingAssignmentsParamsInput = z.infer<
  typeof backfillListingAssignmentsParamsSchema
>;

export const startListingParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    researchItemId: z.string().trim().min(1, "researchItemId is required"),
  })
  .strict();

export type StartListingParamsInput = z.infer<
  typeof startListingParamsSchema
>;

export const startListingBodySchema = z
  .object({})
  .strict()
  .optional();

export type StartListingBodyInput = z.infer<
  typeof startListingBodySchema
>;

export const downloadFinalAssetParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    assetId: z.string().trim().min(1, "assetId is required"),
  })
  .strict();

export type DownloadFinalAssetParamsInput = z.infer<
  typeof downloadFinalAssetParamsSchema
>;

export const completeListingParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    researchItemId: z.string().trim().min(1, "researchItemId is required"),
  })
  .strict();

export type CompleteListingParamsInput = z.infer<
  typeof completeListingParamsSchema
>;

export const completeListingBodySchema = z
  .object({
    etsyListingUrl: z
      .string()
      .trim()
      .max(2048, "etsyListingUrl cannot exceed 2048 characters")
      .nullable()
      .optional()
      .transform((value) => (value && value.length > 0 ? value : null)),
  })
  .strict()
  .default(() => ({ etsyListingUrl: null }));

export type CompleteListingBodyInput = z.infer<
  typeof completeListingBodySchema
>;
