import { z } from "zod";
import { ResearchStatus } from "@prisma/client";
import { extractEtsyListing } from "./research.helper.js";

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
  })
  .strict();

export type CreateResearchItemInput = z.infer<typeof createResearchItemSchema>;

export const getResearchItemsQuerySchema = z.object({
  createdBy: z.string().trim().min(1, "createdBy cannot be empty").optional(),
  status: z.nativeEnum(ResearchStatus, { message: "Invalid status" }).optional(),
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
});

export type GetResearchItemsQueryInput = z.infer<
  typeof getResearchItemsQuerySchema
>;

// Narrows the admin issue queue to the list controls it supports. The status is
// intentionally not client-controlled; the controller always forces ISSUE_REPORTED.
export const getIssueItemsQuerySchema = getResearchItemsQuerySchema
  .pick({
    limit: true,
    page: true,
    search: true,
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

export const previewResearchItemSchema = createResearchItemSchema;

export type PreviewResearchItemInput = CreateResearchItemInput;

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
