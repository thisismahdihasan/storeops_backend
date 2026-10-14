import { z } from "zod";
import { ResearchStatus } from "@prisma/client";
import { extractEtsyListing } from "./research.helper.js";
import {
  isoDateTimeSchema,
  validateDateRange,
} from "../role-activity/roleActivity.validation.js";

export const RESEARCH_STATUS_GROUPS = [
  "all",
  "waiting",
  "in_design",
  "in_listing",
  "listed",
] as const;

export type ResearchStatusGroup = (typeof RESEARCH_STATUS_GROUPS)[number];

export const createResearchItemSchema = z
  .object({
    etsyUrl: z
      .string({ message: "etsyUrl is required" })
      .trim()
      .min(1, "etsyUrl is required")
      .superRefine((val, ctx) => {
        try {
          extractEtsyListing(val);
        } catch (err) {
          if (err instanceof Error) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: err.message,
            });
          } else {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Invalid Etsy listing URL",
            });
          }
        }
      }),
    reuseReference: z
      .preprocess(
        (value) =>
          value === "true" ? true : value === "false" ? false : value,
        z.boolean(),
      )
      .optional()
      .default(false),
    targetProduct: z
      .string()
      .trim()
      .max(100, "Target product cannot exceed 100 characters")
      .transform((val) => (val.length === 0 ? null : val))
      .nullable()
      .optional(),
    uploadSessionToken: z.string().trim().min(1).max(4096).optional(),
  })
  .strict();

export type CreateResearchItemInput = z.infer<typeof createResearchItemSchema>;

export const presignReferenceImageBodySchema = z.object({
  purpose: z.enum(["CREATE_RESEARCH_REFERENCE_IMAGE", "REPLACE_RESEARCH_REFERENCE_IMAGE"]),
  expectedSize: z.number().int().positive().max(10 * 1024 * 1024),
  contentType: z.string().trim().min(1).max(100),
  researchItemId: z.string().trim().min(1).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.purpose === "REPLACE_RESEARCH_REFERENCE_IMAGE" && !value.researchItemId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["researchItemId"], message: "researchItemId is required for replacement" });
  }
  if (value.purpose === "CREATE_RESEARCH_REFERENCE_IMAGE" && value.researchItemId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["researchItemId"], message: "researchItemId is not valid for creation" });
  }
});
export type PresignReferenceImageBodyInput = z.infer<typeof presignReferenceImageBodySchema>;

export const finalizeReferenceImageBodySchema = z.object({
  uploadSessionToken: z.string().trim().min(1).max(4096),
}).strict();

export const getResearchItemsQuerySchema = z.object({
  createdBy: z.string().trim().min(1, "createdBy cannot be empty").optional(),
  status: z.nativeEnum(ResearchStatus, { message: "Invalid status" }).optional(),
  statusGroup: z.enum(RESEARCH_STATUS_GROUPS).optional(),
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
  dateFrom: isoDateTimeSchema.optional(),
  dateTo: isoDateTimeSchema.optional(),
  search: z
    .string()
    .trim()
    .transform((val) => (val.length > 0 ? val : undefined))
    .optional(),
  assignment: z.enum(["UNASSIGNED"]).optional(),
  sort: z.enum(["newest", "oldest", "updated"]).optional(),
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
}).superRefine((query, context) => {
  validateDateRange(query, context);
  if (query.status && query.statusGroup && query.statusGroup !== "all") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "status and statusGroup cannot be used together",
      path: ["statusGroup"],
    });
  }
  if (query.date && (query.dateFrom || query.dateTo)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "date cannot be combined with dateFrom or dateTo",
      path: ["date"],
    });
  }
});

export type GetResearchItemsQueryInput = z.infer<
  typeof getResearchItemsQuerySchema
>;

export const getResearchSummaryQuerySchema = z
  .object({
    dateFrom: isoDateTimeSchema.optional(),
    dateTo: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine(validateDateRange);

export type GetResearchSummaryQueryInput = z.infer<
  typeof getResearchSummaryQuerySchema
>;

// Narrows the admin issue queue to the list controls it supports. The status is
// intentionally not client-controlled; the controller always forces ISSUE_REPORTED.
export const getIssueItemsQuerySchema = z
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
      .transform((val) => (val.length > 0 ? val : undefined))
      .optional(),
  })
  .extend({
    sort: z.enum(["fifo", "newest"]).optional(),
  })
  .strict();

export type GetIssueItemsQueryInput = z.infer<typeof getIssueItemsQuerySchema>;

export const getResearchItemParamsSchema = z.object({
  workspaceId: z.string().trim().min(1, "workspaceId is required"),
  researchItemId: z.string().trim().min(1, "researchItemId is required"),
});

export type GetResearchItemParamsInput = z.infer<
  typeof getResearchItemParamsSchema
>;

export const getReferenceUsageHistoryParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    etsyListingId: z
      .string()
      .trim()
      .regex(/^\d+$/, "etsyListingId must contain digits only")
      .max(30, "etsyListingId cannot exceed 30 characters"),
  })
  .strict();

export type GetReferenceUsageHistoryParamsInput = z.infer<
  typeof getReferenceUsageHistoryParamsSchema
>;

export const getReferenceUsageHistoryQuerySchema = z
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
  })
  .strict();

export type GetReferenceUsageHistoryQueryInput = z.infer<
  typeof getReferenceUsageHistoryQuerySchema
>;

export const getReferenceImageQuerySchema = z.object({
  download: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((val) => val === "true" || val === "1"),
});

export type GetReferenceImageQueryInput = z.infer<
  typeof getReferenceImageQuerySchema
>;

export const reassignDesignerBodySchema = z
  .object({
    designerId: z
      .string({ message: "designerId is required" })
      .trim()
      .min(1, "designerId is required"),
  })
  .strict();

export type ReassignDesignerBodyInput = z.infer<
  typeof reassignDesignerBodySchema
>;

const bulkResearchItemIdsSchema = z
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

export const bulkAssignResearchBodySchema = z.discriminatedUnion("mode", [
  z
    .object({
      researchItemIds: bulkResearchItemIdsSchema,
      mode: z.literal("TARGET"),
      designerId: z
        .string({ message: "designerId is required" })
        .trim()
        .min(1, "designerId is required"),
    })
    .strict(),
  z
    .object({
      researchItemIds: bulkResearchItemIdsSchema,
      mode: z.literal("DISTRIBUTE"),
    })
    .strict(),
]);

export type BulkAssignResearchBodyInput = z.infer<
  typeof bulkAssignResearchBodySchema
>;

export const previewResearchItemSchema = z
  .object({
    etsyUrl: z
      .string({ message: "etsyUrl is required" })
      .trim()
      .min(1, "etsyUrl is required")
      .superRefine((val, ctx) => {
        try {
          extractEtsyListing(val);
        } catch (err) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: err instanceof Error ? err.message : "Invalid Etsy listing URL",
          });
        }
      }),
  })
  .strict();

export type PreviewResearchItemInput = z.infer<typeof previewResearchItemSchema>;

export const updateResearchItemBodySchema = z
  .object({
    title: z
      .string()
      .trim()
      .max(500, "Title cannot exceed 500 characters")
      .transform((val) => (val.length === 0 ? null : val))
      .nullable()
      .optional(),
  })
  .strict();

export type UpdateResearchItemBodyInput = z.infer<
  typeof updateResearchItemBodySchema
>;
