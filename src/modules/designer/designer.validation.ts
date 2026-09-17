import path from "node:path";
import { z } from "zod";
import { ResearchStatus } from "@prisma/client";
import { ApiError } from "../../shared/ApiError.js";

export const DESIGNER_QUEUE_ACTIVE_STATUSES = [
  ResearchStatus.ASSIGNED,
  ResearchStatus.DESIGN_IN_PROGRESS,
  ResearchStatus.DESIGN_REVIEW,
  ResearchStatus.CORRECTION_NEEDED,
  ResearchStatus.ISSUE_REPORTED,
  ResearchStatus.DESIGN_APPROVED,
] as const;

export type DesignerQueueActiveStatus =
  (typeof DESIGNER_QUEUE_ACTIVE_STATUSES)[number];

export const getDesignerWorkQueueQuerySchema = z
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
        (val): val is DesignerQueueActiveStatus =>
          (DESIGNER_QUEUE_ACTIVE_STATUSES as readonly ResearchStatus[]).includes(val),
        {
          message:
            "Invalid status filter. Allowed values: ASSIGNED, DESIGN_IN_PROGRESS, DESIGN_REVIEW, CORRECTION_NEEDED, ISSUE_REPORTED, DESIGN_APPROVED",
        }
      )
      .optional(),
    search: z
      .string()
      .trim()
      .transform((val) => (val.length > 0 ? val : undefined))
      .optional(),
  })
  .strict();

export type GetDesignerWorkQueueQueryInput = z.infer<
  typeof getDesignerWorkQueueQuerySchema
>;

export const ADMIN_DESIGN_WORKFLOW_STATUSES = [
  ResearchStatus.ASSIGNED,
  ResearchStatus.DESIGN_IN_PROGRESS,
  ResearchStatus.DESIGN_REVIEW,
  ResearchStatus.CORRECTION_NEEDED,
  ResearchStatus.ISSUE_REPORTED,
  ResearchStatus.DESIGN_APPROVED,
  ResearchStatus.READY_FOR_LISTING,
  ResearchStatus.LISTING_IN_PROGRESS,
  ResearchStatus.LISTED,
] as const;

export type AdminDesignWorkflowStatus =
  (typeof ADMIN_DESIGN_WORKFLOW_STATUSES)[number];

export const getAdminDesignListQuerySchema = z
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
    designerId: z.string().trim().min(1, "designerId cannot be empty").optional(),
    status: z
      .nativeEnum(ResearchStatus, {
        message: "Invalid status filter",
      })
      .refine(
        (val): val is AdminDesignWorkflowStatus =>
          (ADMIN_DESIGN_WORKFLOW_STATUSES as readonly ResearchStatus[]).includes(val),
        {
          message: "Invalid design status filter",
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
      .transform((val) => (val.length > 0 ? val : undefined))
      .optional(),
  })
  .strict();

export type GetAdminDesignListQueryInput = z.infer<
  typeof getAdminDesignListQuerySchema
>;

export const getDesignDetailParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    researchItemId: z.string().trim().min(1, "researchItemId is required"),
  })
  .strict();

export type GetDesignDetailParamsInput = z.infer<
  typeof getDesignDetailParamsSchema
>;

export const startDesignWorkParamsSchema = z.object({
  workspaceId: z.string().trim().min(1, "workspaceId is required"),
  researchItemId: z.string().trim().min(1, "researchItemId is required"),
});

export type StartDesignWorkParamsInput = z.infer<
  typeof startDesignWorkParamsSchema
>;

export const ISSUE_REPORT_REASONS = [
  "REFERENCE_UNCLEAR",
  "COPYRIGHT_CONCERN",
  "TOO_COMPLEX",
  "IMAGE_QUALITY",
  "OTHER",
] as const;

export type IssueReportReason = (typeof ISSUE_REPORT_REASONS)[number];

export const reportDesignIssueParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    researchItemId: z.string().trim().min(1, "researchItemId is required"),
  })
  .strict();

export type ReportDesignIssueParamsInput = z.infer<
  typeof reportDesignIssueParamsSchema
>;

export const reportDesignIssueBodySchema = z
  .object({
    reason: z.enum(ISSUE_REPORT_REASONS, {
      message:
        "Invalid issue reason. Allowed values: REFERENCE_UNCLEAR, COPYRIGHT_CONCERN, TOO_COMPLEX, IMAGE_QUALITY, OTHER",
    }),
    details: z
      .string()
      .trim()
      .max(1000, "details cannot exceed 1000 characters")
      .transform((val) => (val.length > 0 ? val : undefined))
      .optional(),
  })
  .strict();

export type ReportDesignIssueBodyInput = z.infer<
  typeof reportDesignIssueBodySchema
>;

export const submitDesignReviewParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    researchItemId: z.string().trim().min(1, "researchItemId is required"),
  })
  .strict();

export type SubmitDesignReviewParamsInput = z.infer<
  typeof submitDesignReviewParamsSchema
>;

export const submitDesignReviewBodySchema = z
  .object({
    note: z
      .string()
      .trim()
      .max(2000, "note cannot exceed 2000 characters")
      .transform((val) => (val.length > 0 ? val : undefined))
      .optional(),
  })
  .strict();

export type SubmitDesignReviewBodyInput = z.infer<
  typeof submitDesignReviewBodySchema
>;

export const startCorrectionParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    researchItemId: z.string().trim().min(1, "researchItemId is required"),
  })
  .strict();

export type StartCorrectionParamsInput = z.infer<
  typeof startCorrectionParamsSchema
>;

export const startCorrectionBodySchema = z
  .object({})
  .strict()
  .optional();

export type StartCorrectionBodyInput = z.infer<
  typeof startCorrectionBodySchema
>;

// Multipart policy: supports large production ZIPs up to 1 GiB while keeping the init response bounded.
export const MAX_MULTIPART_FINAL_ASSET_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1 GiB
export const MULTIPART_FINAL_ASSET_PART_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_MULTIPART_FINAL_ASSET_PARTS = Math.ceil(
  MAX_MULTIPART_FINAL_ASSET_FILE_SIZE_BYTES /
    MULTIPART_FINAL_ASSET_PART_SIZE_BYTES
);

// Sanitizes final asset filenames: strips path traversal and control characters, verifies non-empty.
export const sanitizeFinalAssetFileName = (rawName: string): string => {
  if (!rawName || typeof rawName !== "string") {
    throw new ApiError(400, "File name cannot be empty");
  }

  const trimmed = rawName.trim();
  const baseName = path.basename(trimmed);
  const cleaned = baseName.replace(/[\x00-\x1F\x7F]/g, "").trim();

  if (
    cleaned.length === 0 ||
    cleaned === "." ||
    cleaned === ".." ||
    cleaned === "/" ||
    cleaned === "\\"
  ) {
    throw new ApiError(400, "Invalid file name");
  }

  return cleaned;
};


// Validates the server-owned metadata needed to begin a direct multipart ZIP upload.
export const validateMultipartFinalAssetFileName = (fileName: string): string => {
  const sanitizedName = sanitizeFinalAssetFileName(fileName);
  const extension = path.extname(sanitizedName).toLowerCase();

  if (extension !== ".zip") {
    throw new ApiError(400, "Final package must be a .zip file");
  }

  return sanitizedName;
};

export const multipartFinalAssetParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    researchItemId: z.string().trim().min(1, "researchItemId is required"),
  })
  .strict();

export const initFinalAssetMultipartUploadBodySchema = z
  .object({
    fileName: z
      .string({ message: "fileName is required" })
      .trim()
      .min(1, "fileName is required")
      .max(255, "fileName cannot exceed 255 characters"),
    fileSize: z
      .number({ message: "fileSize is required" })
      .int("fileSize must be an integer")
      .positive("fileSize must be greater than zero")
      .max(
        MAX_MULTIPART_FINAL_ASSET_FILE_SIZE_BYTES,
        "fileSize exceeds the 1 GiB multipart ZIP limit"
      ),
  })
  .strict();

export const completeFinalAssetMultipartUploadBodySchema = z
  .object({
    sessionToken: z
      .string({ message: "sessionToken is required" })
      .trim()
      .min(1, "sessionToken is required")
      .max(4096, "sessionToken is invalid"),
    parts: z
      .array(
        z
          .object({
            partNumber: z
              .number()
              .int("partNumber must be an integer")
              .positive("partNumber must be positive")
              .max(MAX_MULTIPART_FINAL_ASSET_PARTS),
            eTag: z
              .string({ message: "eTag is required" })
              .trim()
              .min(1, "eTag is required")
              .max(512, "eTag is invalid"),
          })
          .strict()
      )
      .min(1, "At least one uploaded part is required")
      .max(
        MAX_MULTIPART_FINAL_ASSET_PARTS,
        "Too many multipart upload parts"
      ),
  })
  .strict()
  .superRefine((value, context) => {
    const partNumbers = new Set<number>();

    value.parts.forEach((part, index) => {
      if (partNumbers.has(part.partNumber)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate partNumber is not allowed",
          path: ["parts", index, "partNumber"],
        });
      }
      partNumbers.add(part.partNumber);
    });
  });

export const abortFinalAssetMultipartUploadBodySchema = z
  .object({
    sessionToken: z
      .string({ message: "sessionToken is required" })
      .trim()
      .min(1, "sessionToken is required")
      .max(4096, "sessionToken is invalid"),
  })
  .strict();

export type InitFinalAssetMultipartUploadBodyInput = z.infer<
  typeof initFinalAssetMultipartUploadBodySchema
>;

export type CompleteFinalAssetMultipartUploadBodyInput = z.infer<
  typeof completeFinalAssetMultipartUploadBodySchema
>;

export type AbortFinalAssetMultipartUploadBodyInput = z.infer<
  typeof abortFinalAssetMultipartUploadBodySchema
>;

export const completeDesignParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    researchItemId: z.string().trim().min(1, "researchItemId is required"),
  })
  .strict();

export type CompleteDesignParamsInput = z.infer<
  typeof completeDesignParamsSchema
>;

export const completeDesignBodySchema = z
  .object({})
  .strict()
  .optional();

export type CompleteDesignBodyInput = z.infer<
  typeof completeDesignBodySchema
>;
