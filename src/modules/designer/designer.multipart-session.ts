import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { ApiError } from "../../shared/ApiError.js";

const MULTIPART_SESSION_ISSUER = "storeops-final-asset-multipart";
const MULTIPART_SESSION_AUDIENCE = "storeops-designer";
const MULTIPART_SESSION_EXPIRY = "1h";

export type FinalAssetMultipartSession = {
  workspaceId: string;
  researchItemId: string;
  designerId: string;
  uploadId: string;
  storageKey: string;
  fileName: string;
  expectedSize: number;
  partCount: number;
};

const isFinalAssetMultipartSession = (
  value: unknown
): value is FinalAssetMultipartSession => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.workspaceId === "string" &&
    typeof payload.researchItemId === "string" &&
    typeof payload.designerId === "string" &&
    typeof payload.uploadId === "string" &&
    typeof payload.storageKey === "string" &&
    typeof payload.fileName === "string" &&
    typeof payload.expectedSize === "number" &&
    Number.isSafeInteger(payload.expectedSize) &&
    payload.expectedSize > 0 &&
    typeof payload.partCount === "number" &&
    Number.isSafeInteger(payload.partCount) &&
    payload.partCount > 0
  );
};

// Signs upload state that the client must return but must never be able to alter.
export const signFinalAssetMultipartSession = (
  session: FinalAssetMultipartSession
): string => {
  return jwt.sign(session, env.JWT_SECRET, {
    algorithm: "HS256",
    audience: MULTIPART_SESSION_AUDIENCE,
    expiresIn: MULTIPART_SESSION_EXPIRY,
    issuer: MULTIPART_SESSION_ISSUER,
  });
};

// Verifies the dedicated session's signature, audience, issuer, payload, and expiry.
export const verifyFinalAssetMultipartSession = (
  sessionToken: string
): FinalAssetMultipartSession => {
  try {
    const decoded = jwt.verify(sessionToken, env.JWT_SECRET, {
      algorithms: ["HS256"],
      audience: MULTIPART_SESSION_AUDIENCE,
      issuer: MULTIPART_SESSION_ISSUER,
    });

    if (!isFinalAssetMultipartSession(decoded)) {
      throw new Error("Invalid multipart session payload");
    }

    return decoded;
  } catch {
    throw new ApiError(400, "Invalid or expired multipart upload session");
  }
};
