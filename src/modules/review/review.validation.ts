import { z } from "zod";

export const getReviewQueueQuerySchema = z
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

export type GetReviewQueueQueryInput = z.infer<
  typeof getReviewQueueQuerySchema
>;

export const getReviewQueueParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
  })
  .strict();

export type GetReviewQueueParamsInput = z.infer<
  typeof getReviewQueueParamsSchema
>;

export const getReviewDetailParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    reviewId: z.string().trim().min(1, "reviewId is required"),
  })
  .strict();

export type GetReviewDetailParamsInput = z.infer<
  typeof getReviewDetailParamsSchema
>;

export const createReviewAnnotationParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    reviewId: z.string().trim().min(1, "reviewId is required"),
  })
  .strict();

export type CreateReviewAnnotationParamsInput = z.infer<
  typeof createReviewAnnotationParamsSchema
>;

export const createReviewAnnotationBodySchema = z
  .object({
    x: z
      .number({
        message: "x must be a number",
      })
      .finite("x must be a finite number")
      .min(0, "x must be between 0 and 1")
      .max(1, "x must be between 0 and 1"),
    y: z
      .number({
        message: "y must be a number",
      })
      .finite("y must be a finite number")
      .min(0, "y must be between 0 and 1")
      .max(1, "y must be between 0 and 1"),
    comment: z
      .string({
        message: "comment must be a string",
      })
      .trim()
      .min(1, "comment cannot be empty")
      .max(2000, "comment cannot exceed 2000 characters"),
  })
  .strict();

export type CreateReviewAnnotationBodyInput = z.infer<
  typeof createReviewAnnotationBodySchema
>;

export const createAnnotationReplyParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    annotationId: z.string().trim().min(1, "annotationId is required"),
  })
  .strict();

export type CreateAnnotationReplyParamsInput = z.infer<
  typeof createAnnotationReplyParamsSchema
>;

export const createAnnotationReplyBodySchema = z
  .object({
    message: z
      .string({
        message: "message must be a string",
      })
      .trim()
      .min(1, "message cannot be empty")
      .max(2000, "message cannot exceed 2000 characters"),
  })
  .strict();

export type CreateAnnotationReplyBodyInput = z.infer<
  typeof createAnnotationReplyBodySchema
>;

export const annotationMutationParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    annotationId: z.string().trim().min(1, "annotationId is required"),
  })
  .strict();

export type AnnotationMutationParamsInput = z.infer<
  typeof annotationMutationParamsSchema
>;

export const annotationReplyMutationParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    annotationId: z.string().trim().min(1, "annotationId is required"),
    replyId: z.string().trim().min(1, "replyId is required"),
  })
  .strict();

export type AnnotationReplyMutationParamsInput = z.infer<
  typeof annotationReplyMutationParamsSchema
>;

export const updateReviewAnnotationBodySchema = z
  .object({
    comment: z
      .string({ message: "comment must be a string" })
      .trim()
      .min(1, "comment cannot be empty")
      .max(2000, "comment cannot exceed 2000 characters"),
  })
  .strict();

export type UpdateReviewAnnotationBodyInput = z.infer<
  typeof updateReviewAnnotationBodySchema
>;

export const updateAnnotationReplyBodySchema = z
  .object({
    message: z
      .string({ message: "message must be a string" })
      .trim()
      .min(1, "message cannot be empty")
      .max(2000, "message cannot exceed 2000 characters"),
  })
  .strict();

export type UpdateAnnotationReplyBodyInput = z.infer<
  typeof updateAnnotationReplyBodySchema
>;

export const requestCorrectionParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    reviewId: z.string().trim().min(1, "reviewId is required"),
  })
  .strict();

export type RequestCorrectionParamsInput = z.infer<
  typeof requestCorrectionParamsSchema
>;

export const requestCorrectionBodySchema = z
  .object({})
  .strict()
  .optional();

export type RequestCorrectionBodyInput = z.infer<
  typeof requestCorrectionBodySchema
>;

export const approveReviewParamsSchema = z
  .object({
    workspaceId: z.string().trim().min(1, "workspaceId is required"),
    reviewId: z.string().trim().min(1, "reviewId is required"),
  })
  .strict();

export type ApproveReviewParamsInput = z.infer<
  typeof approveReviewParamsSchema
>;

export const approveReviewBodySchema = z
  .object({})
  .strict()
  .optional();

export type ApproveReviewBodyInput = z.infer<
  typeof approveReviewBodySchema
>;
