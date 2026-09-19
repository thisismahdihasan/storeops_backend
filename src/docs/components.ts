import { env } from "../config/env.js";
import { OpenApiSchema } from "./docs.type.js";

const stringId: OpenApiSchema = { type: "string", minLength: 1 };
const dateTime: OpenApiSchema = { type: "string", format: "date-time" };

export const jsonSuccess = (
  description: string,
  dataSchema?: OpenApiSchema
): Record<string, unknown> => ({
  description,
  content: {
    "application/json": {
      schema: dataSchema
        ? {
            allOf: [
              { $ref: "#/components/schemas/ApiSuccess" },
              {
                type: "object",
                required: ["data"],
                properties: { data: dataSchema },
              },
            ],
          }
        : { $ref: "#/components/schemas/ApiSuccess" },
    },
  },
});

export const jsonError = (description: string): Record<string, unknown> => ({
  description,
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/ApiError" },
    },
  },
});

export const openApiComponents = {
  securitySchemes: {
    cookieAuth: {
      type: "apiKey",
      in: "cookie",
      name: env.COOKIE_NAME,
      description: "HTTP-only session cookie set by register or login.",
    },
  },
  parameters: {
    WorkspaceId: {
      name: "workspaceId",
      in: "path",
      required: true,
      schema: stringId,
    },
    ResearchItemId: {
      name: "researchItemId",
      in: "path",
      required: true,
      schema: stringId,
    },
    ReviewId: {
      name: "reviewId",
      in: "path",
      required: true,
      schema: stringId,
    },
    AnnotationId: {
      name: "annotationId",
      in: "path",
      required: true,
      schema: stringId,
    },
    AssetId: {
      name: "assetId",
      in: "path",
      required: true,
      schema: stringId,
    },
    UserId: {
      name: "userId",
      in: "path",
      required: true,
      schema: stringId,
    },
    Page: {
      name: "page",
      in: "query",
      schema: { type: "integer", minimum: 1, default: 1 },
    },
    Limit: {
      name: "limit",
      in: "query",
      schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    },
  },
  schemas: {
    ApiSuccess: {
      type: "object",
      required: ["success", "message"],
      properties: {
        success: { type: "boolean", enum: [true] },
        message: { type: "string" },
      },
    },
    ApiError: {
      type: "object",
      required: ["success", "message"],
      properties: {
        success: { type: "boolean", enum: [false] },
        message: { type: "string" },
        data: { type: "object", additionalProperties: true },
      },
    },
    WorkspaceRole: {
      type: "string",
      enum: ["ADMIN", "RESEARCHER", "DESIGNER", "LISTER"],
    },
    ResearchStatus: {
      type: "string",
      enum: [
        "RESEARCHED", "ASSIGNED", "DESIGN_IN_PROGRESS", "DESIGN_REVIEW",
        "CORRECTION_NEEDED", "ISSUE_REPORTED", "DESIGN_APPROVED",
        "READY_FOR_LISTING", "LISTING_IN_PROGRESS", "LISTED",
      ],
    },
    IssueReason: {
      type: "string",
      enum: [
        "REFERENCE_UNCLEAR", "COPYRIGHT_CONCERN", "TOO_COMPLEX",
        "IMAGE_QUALITY", "OTHER",
      ],
    },
    DashboardDatePreset: {
      type: "string",
      enum: ["all", "today", "week", "month", "custom"],
    },
    UserSummary: {
      type: "object",
      required: ["id", "email", "name", "profileImageUrl", "createdAt"],
      properties: {
        id: stringId,
        email: { type: "string", format: "email" },
        name: { type: "string", nullable: true },
        profileImageUrl: { type: "string", format: "uri", nullable: true },
        createdAt: dateTime,
      },
    },
    CreatedBySummary: {
      type: "object",
      required: ["id", "email", "name", "profileImageUrl"],
      properties: {
        id: stringId,
        email: { type: "string", format: "email" },
        name: { type: "string", nullable: true },
        profileImageUrl: { type: "string", format: "uri", nullable: true },
      },
    },
    NullableUserSummary: {
      type: "object",
      nullable: true,
      required: ["id", "email", "name", "profileImageUrl"],
      properties: {
        id: stringId,
        email: { type: "string", format: "email" },
        name: { type: "string", nullable: true },
        profileImageUrl: { type: "string", format: "uri", nullable: true },
      },
    },
    ListingDetailPerson: {
      type: "object",
      required: ["id", "name", "profileImageUrl"],
      properties: {
        id: stringId,
        name: { type: "string", nullable: true },
        profileImageUrl: { type: "string", format: "uri", nullable: true },
      },
    },
    NullableListingDetailPerson: {
      type: "object",
      nullable: true,
      required: ["id", "name", "profileImageUrl"],
      properties: {
        id: stringId,
        name: { type: "string", nullable: true },
        profileImageUrl: { type: "string", format: "uri", nullable: true },
      },
    },
    WorkspaceSummary: {
      type: "object",
      required: ["id", "name", "designerAutoAssignmentEnabled", "listerAutoAssignmentEnabled", "finalAssetAutoCleanupEnabled", "finalAssetRetentionDays"],
      properties: { 
        id: stringId, 
        name: { type: "string" },
        designerAutoAssignmentEnabled: { type: "boolean" },
        listerAutoAssignmentEnabled: { type: "boolean" },
        finalAssetAutoCleanupEnabled: { type: "boolean" },
        finalAssetRetentionDays: { type: "integer", minimum: 1, maximum: 365 },
      },
    },
    Workspace: {
      type: "object",
      required: ["id", "name", "ownerId", "designerAutoAssignmentEnabled", "listerAutoAssignmentEnabled", "finalAssetAutoCleanupEnabled", "finalAssetRetentionDays", "createdAt", "updatedAt"],
      properties: {
        id: stringId, name: { type: "string" }, ownerId: stringId,
        designerAutoAssignmentEnabled: { type: "boolean" },
        listerAutoAssignmentEnabled: { type: "boolean" },
        finalAssetAutoCleanupEnabled: { type: "boolean" },
        finalAssetRetentionDays: { type: "integer", minimum: 1, maximum: 365 },
        createdAt: dateTime, updatedAt: dateTime,
      },
    },
    WorkspaceMembership: {
      type: "object",
      required: ["id", "workspaceId", "userId", "roles", "createdAt"],
      properties: {
        id: stringId, workspaceId: stringId, userId: stringId,
        roles: { type: "array", items: { $ref: "#/components/schemas/WorkspaceRole" } },
        createdAt: dateTime,
      },
    },
    Pagination: {
      type: "object",
      required: ["page", "limit", "total", "totalPages"],
      properties: {
        page: { type: "integer" }, limit: { type: "integer" },
        total: { type: "integer" }, totalPages: { type: "integer" },
      },
    },
    ResearchItemSafe: {
      type: "object",
      required: [
        "id", "workspaceId", "etsyListingId", "originalUrl", "normalizedUrl",
        "title", "referenceImageUrl", "status", "createdAt", "updatedAt",
      ],
      properties: {
        id: stringId, workspaceId: stringId, etsyListingId: { type: "string" },
        originalUrl: { type: "string", format: "uri" },
        normalizedUrl: { type: "string", format: "uri" },
        title: { type: "string", nullable: true },
        referenceImageUrl: { type: "string", format: "uri", nullable: true },
        status: { $ref: "#/components/schemas/ResearchStatus" },
        createdAt: dateTime, updatedAt: dateTime,
      },
    },
    AssignmentSummary: {
      type: "object",
      required: ["id", "designerId", "assignedAt", "isCurrent"],
      properties: {
        id: stringId, designerId: stringId, assignedAt: dateTime,
        isCurrent: { type: "boolean" },
      },
    },
    CurrentDesignAssignment: {
      type: "object",
      nullable: true,
      required: ["id", "designerId", "assignedAt", "startedAt", "completedAt", "isCurrent"],
      properties: {
        id: stringId,
        designerId: stringId,
        assignedAt: dateTime,
        startedAt: { ...dateTime, nullable: true },
        completedAt: { ...dateTime, nullable: true },
        isCurrent: { type: "boolean", enum: [true] },
      },
    },
    SafeFinalAsset: {
      type: "object",
      required: ["id", "fileName", "fileSize", "mimeType"],
      properties: {
        id: stringId, fileName: { type: "string" },
        fileSize: { type: "string", description: "Decimal byte count." },
        mimeType: { type: "string" },
      },
    },
    ListerQueueResearchItem: {
      type: "object",
      required: [
        "id", "etsyListingId", "originalUrl", "title", "status",
      ],
      properties: {
        id: stringId,
        etsyListingId: { type: "string" },
        originalUrl: { type: "string", format: "uri" },
        title: { type: "string", nullable: true },
        status: {
          type: "string",
          enum: ["READY_FOR_LISTING", "LISTING_IN_PROGRESS"],
        },
      },
    },
    ListerQueueApprovedPreview: {
      type: "object",
      nullable: true,
      required: ["imageUrl", "imageDeletedAt"],
      properties: {
        imageUrl: { type: "string", format: "uri", nullable: true },
        imageDeletedAt: { ...dateTime, nullable: true },
      },
    },
    ListingDetailResearchItem: {
      type: "object",
      required: [
        "id", "etsyListingId", "title", "originalUrl", "normalizedUrl",
        "status", "createdAt", "updatedAt",
      ],
      properties: {
        id: stringId,
        etsyListingId: { type: "string" },
        title: { type: "string", nullable: true },
        originalUrl: { type: "string", format: "uri" },
        normalizedUrl: { type: "string", format: "uri" },
        status: {
          type: "string",
          enum: ["READY_FOR_LISTING", "LISTING_IN_PROGRESS"],
        },
        createdAt: dateTime,
        updatedAt: dateTime,
      },
    },
    ListingAssignmentDetail: {
      type: "object",
      required: [
        "id", "assignedAt", "startedAt", "completedAt", "isCurrent",
      ],
      properties: {
        id: stringId,
        assignedAt: dateTime,
        startedAt: { ...dateTime, nullable: true },
        completedAt: { ...dateTime, nullable: true },
        isCurrent: { type: "boolean", enum: [true] },
      },
    },
    ListingApprovedPreview: {
      type: "object",
      nullable: true,
      required: [
        "reviewId", "roundNumber", "imageUrl", "imageDeletedAt", "approvedAt",
      ],
      properties: {
        reviewId: stringId,
        roundNumber: { type: "integer" },
        imageUrl: { type: "string", format: "uri", nullable: true },
        imageDeletedAt: { ...dateTime, nullable: true },
        approvedAt: dateTime,
      },
    },
    ListingDetailFinalAsset: {
      type: "object",
      required: ["id", "fileName", "fileSize", "mimeType", "uploadedAt"],
      properties: {
        id: stringId,
        fileName: { type: "string" },
        fileSize: { type: "string", pattern: "^\\d+$", description: "Decimal byte count." },
        mimeType: { type: "string" },
        uploadedAt: dateTime,
      },
    },
    Notification: {
      type: "object",
      required: ["id", "type", "title", "message", "researchItemId", "workspaceId", "isRead", "createdAt"],
      properties: {
        id: stringId,
        type: { type: "string", enum: ["DESIGN_ASSIGNED", "DESIGN_ISSUE_REPORTED", "DESIGN_REVIEW_SUBMITTED", "DESIGN_CORRECTION_REQUESTED", "DESIGN_APPROVED", "LISTING_ASSIGNED"] },
        title: { type: "string" }, message: { type: "string" },
        researchItemId: { type: "string", nullable: true },
        workspaceId: { type: "string" },
        isRead: { type: "boolean" }, createdAt: dateTime,
      },
    },
  },
};
