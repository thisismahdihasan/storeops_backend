import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import multer from "multer";
import { Request, Response, NextFunction } from "express";
import { ApiError } from "../../shared/ApiError.js";
import {
  ALLOWED_FINAL_ASSET_EXTENSIONS,
  AllowedFinalAssetExtension,
  EXTENSION_MIME_MAP,
  MAX_FINAL_ASSET_FILES,
  MAX_FINAL_ASSET_FILE_SIZE_BYTES,
  sanitizeFinalAssetFileName,
} from "./designer.validation.js";

// Bounded temporary disk storage: streams chunks to OS temporary directory without buffering in Node memory
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, os.tmpdir());
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
    const safeExt = path.extname(file.originalname).toLowerCase();
    cb(null, `storeops-final-${uniqueSuffix}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FINAL_ASSET_FILE_SIZE_BYTES,
    files: MAX_FINAL_ASSET_FILES,
  },
  fileFilter: (_req, file, cb) => {
    try {
      const sanitizedName = sanitizeFinalAssetFileName(file.originalname);
      const ext = path.extname(sanitizedName).toLowerCase() as AllowedFinalAssetExtension;

      if (!ALLOWED_FINAL_ASSET_EXTENSIONS.includes(ext)) {
        return cb(
          new ApiError(
            400,
            `Unsupported file type "${ext}". Allowed type: .zip`
          )
        );
      }

      const normalizedMime = file.mimetype?.trim().toLowerCase();
      const allowedMimes = EXTENSION_MIME_MAP[ext];
      if (!allowedMimes || !allowedMimes.includes(normalizedMime)) {
        return cb(
          new ApiError(
            400,
            `Invalid MIME type "${normalizedMime}" for file "${sanitizedName}". Expected one of: ${allowedMimes.join(", ")}`
          )
        );
      }

      cb(null, true);
    } catch (err: unknown) {
      if (err instanceof ApiError) return cb(err);
      cb(new ApiError(400, "Invalid file upload"));
    }
  },
}).any();

// Middleware handling streaming multipart upload for final production assets
export const finalAssetsUploadMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  upload(req, res, async (err: unknown) => {
    const cleanupTempFiles = async (): Promise<void> => {
      const files = req.files as Express.Multer.File[] | undefined;
      if (Array.isArray(files)) {
        for (const file of files) {
          if (file.path) {
            try {
              await fs.promises.unlink(file.path);
            } catch {
              // Ignore cleanup error during middleware rejection
            }
          }
        }
      }
    };

    if (err) {
      await cleanupTempFiles();

      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return next(
            new ApiError(400, "File size exceeds maximum limit of 100MB per file")
          );
        }
        if (
          err.code === "LIMIT_FILE_COUNT" ||
          err.code === "LIMIT_UNEXPECTED_FILE"
        ) {
          return next(
            new ApiError(
              400,
              "Exactly one final asset file is required"
            )
          );
        }
        return next(new ApiError(400, `Upload error: ${err.message}`));
      }

      if (err instanceof ApiError) {
        return next(err);
      }

      return next(new ApiError(400, "Invalid file upload"));
    }

    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || !Array.isArray(files) || files.length !== MAX_FINAL_ASSET_FILES) {
      await cleanupTempFiles();
      return next(new ApiError(400, "Exactly one final asset file is required"));
    }

    // Enforce accepted field names: files or file
    for (const file of files) {
      if (file.fieldname !== "files" && file.fieldname !== "file") {
        await cleanupTempFiles();
        return next(
          new ApiError(
            400,
            `Invalid form field "${file.fieldname}". Upload files using field "files".`
          )
        );
      }
    }

    next();
  });
};
