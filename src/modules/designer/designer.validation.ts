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

export const uploadFinalAssetsParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    researchItemId: z.string().trim().min(1, "researchItemId is required"),
  })
  .strict();

export type UploadFinalAssetsParamsInput = z.infer<
  typeof uploadFinalAssetsParamsSchema
>;

export const MAX_FINAL_ASSET_FILES = 1;
export const MAX_FINAL_ASSET_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100MB per file

export const ALLOWED_FINAL_ASSET_EXTENSIONS = [".zip"] as const;

export type AllowedFinalAssetExtension =
  (typeof ALLOWED_FINAL_ASSET_EXTENSIONS)[number];

export const ALLOWED_FINAL_ASSET_MIMETYPES = [
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
] as const;

export type AllowedFinalAssetMimeType =
  (typeof ALLOWED_FINAL_ASSET_MIMETYPES)[number];

export const EXTENSION_MIME_MAP: Record<
  AllowedFinalAssetExtension,
  readonly string[]
> = {
  ".zip": [
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
  ],
};

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

// Validates that a file has an allowed extension, matching MIME type, and safe size.
export const validateFinalAssetFile = (file: {
  originalname: string;
  mimetype: string;
  size?: number;
}): {
  sanitizedName: string;
  extension: AllowedFinalAssetExtension;
  mimeType: string;
} => {
  const sanitizedName = sanitizeFinalAssetFileName(file.originalname);
  const ext = path.extname(sanitizedName).toLowerCase() as AllowedFinalAssetExtension;

  if (!ALLOWED_FINAL_ASSET_EXTENSIONS.includes(ext)) {
    throw new ApiError(
      400,
      `Unsupported file type "${ext}". Allowed type: .zip`
    );
  }

  const normalizedMime = file.mimetype.trim().toLowerCase();
  const allowedMimesForExt = EXTENSION_MIME_MAP[ext];

  if (!allowedMimesForExt || !allowedMimesForExt.includes(normalizedMime)) {
    throw new ApiError(
      400,
      `Invalid MIME type "${normalizedMime}" for file "${sanitizedName}". Expected one of: ${allowedMimesForExt.join(", ")}`
    );
  }

  if (file.size !== undefined && file.size > MAX_FINAL_ASSET_FILE_SIZE_BYTES) {
    throw new ApiError(
      400,
      `File "${sanitizedName}" exceeds maximum limit of 100MB per file`
    );
  }

  return {
    sanitizedName,
    extension: ext,
    mimeType: normalizedMime,
  };
};

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
