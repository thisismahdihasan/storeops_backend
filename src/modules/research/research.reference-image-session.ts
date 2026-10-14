import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { ApiError } from "../../shared/ApiError.js";

const ISSUER = "storeops-reference-image-upload";
const AUDIENCE = "storeops-research";
const EXPIRY = "5m";

export type ReferenceImageUploadPurpose =
  | "CREATE_RESEARCH_REFERENCE_IMAGE"
  | "REPLACE_RESEARCH_REFERENCE_IMAGE";

export type ReferenceImageUploadSession = {
  purpose: ReferenceImageUploadPurpose;
  workspaceId: string;
  userId: string;
  tempStorageKey: string;
  expectedSize: number;
  researchItemId?: string;
};

const isSession = (value: unknown): value is ReferenceImageUploadSession => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.purpose === "string" &&
    (item.purpose === "CREATE_RESEARCH_REFERENCE_IMAGE" || item.purpose === "REPLACE_RESEARCH_REFERENCE_IMAGE") &&
    typeof item.workspaceId === "string" && typeof item.userId === "string" &&
    typeof item.tempStorageKey === "string" && typeof item.expectedSize === "number" &&
    Number.isSafeInteger(item.expectedSize) && item.expectedSize > 0 &&
    (item.researchItemId === undefined || typeof item.researchItemId === "string");
};

export const signReferenceImageUploadSession = (session: ReferenceImageUploadSession): string =>
  jwt.sign(session, env.JWT_SECRET, { algorithm: "HS256", audience: AUDIENCE, issuer: ISSUER, expiresIn: EXPIRY });

export const verifyReferenceImageUploadSession = (token: string): ReferenceImageUploadSession => {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"], audience: AUDIENCE, issuer: ISSUER });
    if (!isSession(decoded)) throw new Error("Invalid upload session");
    return decoded;
  } catch {
    throw new ApiError(400, "Invalid or expired reference image upload session");
  }
};
