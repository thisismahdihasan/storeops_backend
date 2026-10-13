import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(5000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  FRONTEND_URLS: z
    .string()
    .min(1, "FRONTEND_URLS is required")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    )
    .refine((origins) => origins.length > 0, {
      message: "FRONTEND_URLS must contain at least one origin",
    })
    .refine(
      (origins) =>
        origins.every((origin) => {
          try {
            return new URL(origin).origin === origin;
          } catch {
            return false;
          }
        }),
      {
        message:
          "FRONTEND_URLS must be a comma-separated list of absolute origins without paths or trailing slashes",
      }
    ),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_EXPIRES_IN: z
    .string()
    .regex(
      /^\d+[smhdwy]$/,
      "JWT_EXPIRES_IN must be a valid timespan (e.g. 7d, 24h, 3600s)"
    )
    .default("7d"),
  COOKIE_NAME: z.string().default("storeops_token"),
  RESEND_API_KEY: z.string().trim().min(1, "RESEND_API_KEY is required"),
  EMAIL_FROM: z.string().trim().min(1, "EMAIL_FROM is required"),
  FRONTEND_INVITE_URL: z.string().url("FRONTEND_INVITE_URL must be a valid URL"),
  CLOUDINARY_CLOUD_NAME: z.string().trim().optional(),
  CLOUDINARY_API_KEY: z.string().trim().optional(),
  CLOUDINARY_API_SECRET: z.string().trim().optional(),
  ETSY_API_KEYSTRING: z.string().trim().optional(),
  ETSY_API_SHARED_SECRET: z.string().trim().optional(),
  R2_ACCESS_KEY_ID: z.string().trim().min(1, "R2_ACCESS_KEY_ID is required"),
  R2_SECRET_ACCESS_KEY: z.string().trim().min(1, "R2_SECRET_ACCESS_KEY is required"),
  R2_BUCKET_NAME: z.string().trim().min(1, "R2_BUCKET_NAME is required"),
  R2_ENDPOINT: z.string().trim().url("R2_ENDPOINT must be a valid URL"),
  CRON_SECRET: z
    .string()
    .trim()
    .min(32, "CRON_SECRET must be at least 32 characters"),
})
.superRefine((data, ctx) => {
  const hasCloudName = Boolean(data.CLOUDINARY_CLOUD_NAME && data.CLOUDINARY_CLOUD_NAME.trim().length > 0);
  const hasApiKey = Boolean(data.CLOUDINARY_API_KEY && data.CLOUDINARY_API_KEY.trim().length > 0);
  const hasApiSecret = Boolean(data.CLOUDINARY_API_SECRET && data.CLOUDINARY_API_SECRET.trim().length > 0);
  const hasEtsyApiKeystring = Boolean(
    data.ETSY_API_KEYSTRING && data.ETSY_API_KEYSTRING.trim().length > 0,
  );
  const hasEtsyApiSharedSecret = Boolean(
    data.ETSY_API_SHARED_SECRET && data.ETSY_API_SHARED_SECRET.trim().length > 0,
  );

  const anyProvided = hasCloudName || hasApiKey || hasApiSecret;
  const allProvided = hasCloudName && hasApiKey && hasApiSecret;

  if (data.NODE_ENV === "production") {
    if (!hasCloudName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CLOUDINARY_CLOUD_NAME is required in production",
        path: ["CLOUDINARY_CLOUD_NAME"],
      });
    }
    if (!hasApiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CLOUDINARY_API_KEY is required in production",
        path: ["CLOUDINARY_API_KEY"],
      });
    }
    if (!hasApiSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CLOUDINARY_API_SECRET is required in production",
        path: ["CLOUDINARY_API_SECRET"],
      });
    }
  } else if (anyProvided && !allProvided) {
    if (!hasCloudName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CLOUDINARY_CLOUD_NAME is required when Cloudinary configuration is provided",
        path: ["CLOUDINARY_CLOUD_NAME"],
      });
    }
    if (!hasApiKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CLOUDINARY_API_KEY is required when Cloudinary configuration is provided",
        path: ["CLOUDINARY_API_KEY"],
      });
    }
    if (!hasApiSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CLOUDINARY_API_SECRET is required when Cloudinary configuration is provided",
        path: ["CLOUDINARY_API_SECRET"],
      });
    }
  }

  if (data.NODE_ENV === "production") {
    try {
      const endpoint = new URL(data.R2_ENDPOINT);
      if (endpoint.protocol !== "https:") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "R2_ENDPOINT must use HTTPS in production",
          path: ["R2_ENDPOINT"],
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "R2_ENDPOINT must be a valid URL",
        path: ["R2_ENDPOINT"],
      });
    }
  }

  if (hasEtsyApiKeystring !== hasEtsyApiSharedSecret) {
    if (!hasEtsyApiKeystring) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ETSY_API_KEYSTRING is required when ETSY_API_SHARED_SECRET is provided",
        path: ["ETSY_API_KEYSTRING"],
      });
    }
    if (!hasEtsyApiSharedSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ETSY_API_SHARED_SECRET is required when ETSY_API_KEYSTRING is provided",
        path: ["ETSY_API_SHARED_SECRET"],
      });
    }
  }
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error("❌ Invalid environment variables:", parsedEnv.error.format());
  throw new Error("Invalid environment variables");
}

export const env = parsedEnv.data;
export default env;
