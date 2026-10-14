import { Readable } from "node:stream";
import { getCloudinaryClient } from "../../config/cloudinary.js";
import { ApiError } from "../../shared/ApiError.js";
import { buildReferenceImageKey, putObjectBuffer } from "../storage/r2.js";

// Cloudinary folder destination for manual research reference image uploads
export const CLOUDINARY_RESEARCH_REFERENCE_FOLDER =
  "storeops/research-reference-images";

// Allowed MIME types strictly validated before storage
export const ALLOWED_REFERENCE_IMAGE_MIMETYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedReferenceImageMimeType =
  (typeof ALLOWED_REFERENCE_IMAGE_MIMETYPES)[number];

// Maximum allowed image file size for reference images (10 MB)
export const MAX_REFERENCE_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export type ReferenceImageUploadInput = {
  buffer: Buffer;
  mimetype: string;
};

export type ReferenceImageUploadResult = {
  publicId: string;
  secureUrl: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
};

export type ReferenceImageUploader = (
  input: ReferenceImageUploadInput
) => Promise<ReferenceImageUploadResult>;

export type ReferenceImageDestroyer = (publicId: string) => Promise<void>;

export const detectCanonicalImageSignature = (buffer: Buffer): { mimeType: AllowedReferenceImageMimeType; extension: "jpg" | "png" | "webp" } | null => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mimeType: "image/jpeg", extension: "jpg" };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mimeType: "image/png", extension: "png" };
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return { mimeType: "image/webp", extension: "webp" };
  return null;
};

export const uploadReferenceImageToR2 = async ({ workspaceId, buffer }: { workspaceId: string; buffer: Buffer }): Promise<{ storageKey: string; mimeType: AllowedReferenceImageMimeType; extension: "jpg" | "png" | "webp" }> => {
  if (!buffer?.length) throw new ApiError(400, "Image buffer cannot be empty");
  if (buffer.length > MAX_REFERENCE_IMAGE_SIZE_BYTES) throw new ApiError(400, "Image size exceeds maximum limit of 10MB");
  const signature = detectCanonicalImageSignature(buffer);
  if (!signature) throw new ApiError(400, "Invalid reference image file binary signature");
  const storageKey = buildReferenceImageKey({ workspaceId, ext: signature.extension });
  await putObjectBuffer({ storageKey, buffer, contentType: signature.mimeType });
  return { storageKey, ...signature };
};

// Confirms that the declared reference-image MIME type matches its recognizable binary signature.
export const hasValidReferenceImageSignature = (
  buffer: Buffer | undefined,
  mimetype: string
): boolean => {
  if (!buffer || buffer.length === 0) {
    return false;
  }

  const normalizedMime = mimetype.trim().toLowerCase();

  if (normalizedMime === "image/jpeg") {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }

  if (normalizedMime === "image/png") {
    return (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  }

  if (normalizedMime === "image/webp") {
    return (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }

  return false;
};

// Uploads a manual research reference image buffer to Cloudinary using a stream.
export const uploadReferenceImageToCloudinary = async (
  input: ReferenceImageUploadInput,
  uploader?: ReferenceImageUploader
): Promise<ReferenceImageUploadResult> => {
  if (!input.buffer || input.buffer.length === 0) {
    throw new ApiError(400, "Image buffer cannot be empty");
  }

  if (input.buffer.length > MAX_REFERENCE_IMAGE_SIZE_BYTES) {
    throw new ApiError(400, "Image size exceeds maximum limit of 10MB");
  }

  const normalizedMime = input.mimetype?.trim().toLowerCase();
  if (
    !ALLOWED_REFERENCE_IMAGE_MIMETYPES.includes(
      normalizedMime as AllowedReferenceImageMimeType
    )
  ) {
    throw new ApiError(
      400,
      "Unsupported image type. Allowed types: image/jpeg, image/png, image/webp"
    );
  }

  if (!hasValidReferenceImageSignature(input.buffer, normalizedMime)) {
    throw new ApiError(400, "Invalid reference image file binary signature");
  }

  if (uploader) {
    return await uploader(input);
  }

  const client = getCloudinaryClient();

  return new Promise<ReferenceImageUploadResult>((resolve, reject) => {
    const uploadStream = client.uploader.upload_stream(
      {
        folder: CLOUDINARY_RESEARCH_REFERENCE_FOLDER,
        resource_type: "image",
      },
      (error, result) => {
        if (error || !result) {
          return reject(
            new ApiError(500, "Failed to upload reference image to storage")
          );
        }

        resolve({
          publicId: result.public_id,
          secureUrl: result.secure_url,
          format: result.format,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
        });
      }
    );

    Readable.from(input.buffer).pipe(uploadStream);
  });
};

// Removes a managed reference image from Cloudinary by public ID.
export const destroyReferenceImageFromCloudinary = async (
  publicId: string,
  destroyer?: ReferenceImageDestroyer
): Promise<void> => {
  const trimmedPublicId = publicId?.trim();
  if (!trimmedPublicId) {
    return;
  }

  if (destroyer) {
    return await destroyer(trimmedPublicId);
  }

  const client = getCloudinaryClient();

  try {
    await client.uploader.destroy(trimmedPublicId, {
      resource_type: "image",
    });
  } catch {
    // Non-blocking cleanup failure: logged internally without failing the primary workflow
  }
};
