import { jsonError, jsonSuccess } from "../components.js";
import { OpenApiPathMap } from "../docs.type.js";

const researchItemContext = () => ({
  type: "object",
  required: ["id", "etsyListingId", "originalUrl", "normalizedUrl", "title", "referenceImageUrl", "status", "createdAt", "updatedAt", "createdBy"],
  properties: {
    id: { type: "string" }, etsyListingId: { type: "string" },
    originalUrl: { type: "string", format: "uri" }, normalizedUrl: { type: "string", format: "uri" },
    title: { type: "string", nullable: true }, referenceImageUrl: { type: "string", format: "uri", nullable: true },
    status: { $ref: "#/components/schemas/ResearchStatus" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
    createdBy: { $ref: "#/components/schemas/CreatedBySummary" },
  },
});

const reviewHistoryItem = () => ({
  type: "object",
  required: ["id", "roundNumber", "imageUrl", "imageDeletedAt", "note", "submittedAt", "approvedAt", "approvedById", "annotations"],
  properties: {
    id: { type: "string" }, roundNumber: { type: "integer" }, imageUrl: { type: "string", format: "uri", nullable: true },
    imageDeletedAt: { type: "string", format: "date-time", nullable: true }, note: { type: "string", nullable: true },
    submittedAt: { type: "string", format: "date-time" }, approvedAt: { type: "string", format: "date-time", nullable: true }, approvedById: { type: "string", nullable: true },
    annotations: { type: "array", items: { type: "object", required: ["id", "x", "y", "comment", "resolved", "createdAt", "updatedAt", "createdBy", "replies"], properties: {
      id: { type: "string" }, x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 },
      comment: { type: "string" }, resolved: { type: "boolean" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
      createdBy: { type: "object", required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string", nullable: true } } },
      replies: { type: "array", items: { type: "object", required: ["id", "message", "createdAt", "updatedAt", "createdBy"], properties: {
        id: { type: "string" }, message: { type: "string" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
        createdBy: { type: "object", required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string", nullable: true } } },
      } } },
    } } },
  },
});

const adminWorkflowErrors = {
  "401": jsonError("Authentication is required."),
  "403": jsonError("Explicit ADMIN role is required."),
  "404": jsonError("Review submission was not found."),
  "409": jsonError("Only the current DESIGN_REVIEW round allows this action."),
};

const correctionFeedbackRequiredError = {
  description: "At least one correction annotation is required on the current review round.",
  content: {
    "application/json": {
      schema: {
        allOf: [
          { $ref: "#/components/schemas/ApiError" },
          {
            type: "object",
            required: ["data"],
            properties: {
              message: {
                type: "string",
                enum: ["Add at least one correction note before requesting changes."],
              },
              data: {
                type: "object",
                required: ["code"],
                properties: {
                  code: { type: "string", enum: ["CORRECTION_FEEDBACK_REQUIRED"] },
                },
              },
            },
          },
        ],
      },
    },
  },
};

export const reviewPaths: OpenApiPathMap = {
  "/api/v1/workspaces/{workspaceId}/reviews": {
    get: {
      tags: ["Reviews"], summary: "List review submissions awaiting ADMIN action", security: [{ cookieAuth: [] }],
      description: "ADMIN only. Returns the latest review for each DESIGN_REVIEW item, without historical rounds.",
      parameters: [{ $ref: "#/components/parameters/WorkspaceId" }, { $ref: "#/components/parameters/Page" }, { $ref: "#/components/parameters/Limit" }],
      responses: { "200": jsonSuccess("Review queue retrieved successfully.", { type: "object", required: ["items", "pagination"], properties: { items: { type: "array", items: { type: "object", required: ["review", "researchItem", "designer"], properties: { review: { type: "object", required: ["id", "roundNumber", "imageUrl", "imageDeletedAt", "note", "submittedAt"], properties: { id: { type: "string" }, roundNumber: { type: "integer" }, imageUrl: { type: "string", format: "uri", nullable: true }, imageDeletedAt: { type: "string", format: "date-time", nullable: true }, note: { type: "string", nullable: true }, submittedAt: { type: "string", format: "date-time" } } }, researchItem: { type: "object", required: ["id", "etsyListingId", "title", "status", "originalUrl", "normalizedUrl"], properties: { id: { type: "string" }, etsyListingId: { type: "string" }, title: { type: "string", nullable: true }, status: { type: "string", enum: ["DESIGN_REVIEW"] }, originalUrl: { type: "string", format: "uri" }, normalizedUrl: { type: "string", format: "uri" } } }, designer: { $ref: "#/components/schemas/NullableUserSummary" } } } }, pagination: { $ref: "#/components/schemas/Pagination" } } }), "400": jsonError("Invalid queue query."), "401": jsonError("Authentication is required."), "403": jsonError("Explicit ADMIN role is required.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/reviews/{reviewId}": {
    get: {
      tags: ["Reviews"], summary: "Get one accessible review with complete history", security: [{ cookieAuth: [] }],
      description: "ADMIN may read any workspace review. DESIGNER may read only an item for which they are the current assigned designer. Rounds are ascending by round number; annotations and replies are ascending by creation time. imageUrl is null whenever imageDeletedAt is set.",
      parameters: [{ $ref: "#/components/parameters/WorkspaceId" }, { $ref: "#/components/parameters/ReviewId" }],
      responses: { "200": jsonSuccess("Review retrieved successfully.", { type: "object", required: ["researchItem", "currentDesigner", "currentDesignAssignment", "selectedReview", "latestReviewId", "reviews"], properties: { researchItem: researchItemContext(), currentDesigner: { $ref: "#/components/schemas/NullableUserSummary" }, currentDesignAssignment: { type: "object", nullable: true, properties: { id: { type: "string" }, designerId: { type: "string" }, assignedAt: { type: "string", format: "date-time" }, startedAt: { type: "string", format: "date-time", nullable: true }, completedAt: { type: "string", format: "date-time", nullable: true }, isCurrent: { type: "boolean" } } }, selectedReview: reviewHistoryItem(), latestReviewId: { type: "string" }, reviews: { type: "array", items: reviewHistoryItem() } } }), "401": jsonError("Authentication is required."), "403": jsonError("ADMIN role or current designer assignment is required."), "404": jsonError("Review submission was not found.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/reviews/{reviewId}/annotations": {
    post: {
      tags: ["Reviews"], summary: "Create a point annotation on the current review", security: [{ cookieAuth: [] }],
      description: "ADMIN only. The coordinates are normalized from 0 through 1; annotations are permitted only on the latest DESIGN_REVIEW round.",
      parameters: [{ $ref: "#/components/parameters/WorkspaceId" }, { $ref: "#/components/parameters/ReviewId" }],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["x", "y", "comment"], properties: { x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 }, comment: { type: "string", minLength: 1, maxLength: 2000 } } } } } },
      responses: { "201": jsonSuccess("Review annotation created successfully.", { type: "object", required: ["annotation"], properties: { annotation: { type: "object", required: ["id", "reviewSubmissionId", "x", "y", "comment", "resolved", "createdAt", "updatedAt", "createdBy"], properties: { id: { type: "string" }, reviewSubmissionId: { type: "string" }, x: { type: "number" }, y: { type: "number" }, comment: { type: "string" }, resolved: { type: "boolean", enum: [false] }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, createdBy: { type: "object", required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string", nullable: true } } } } } } }), "400": jsonError("Invalid annotation body."), ...adminWorkflowErrors },
    },
  },
  "/api/v1/workspaces/{workspaceId}/reviews/{reviewId}/request-correction": {
    post: {
      tags: ["Reviews"], summary: "Request a correction for the current review", security: [{ cookieAuth: [] }],
      description: "ADMIN only. The latest DESIGN_REVIEW round must have at least one correction annotation before the item transitions to CORRECTION_NEEDED and the current designer is notified.", parameters: [{ $ref: "#/components/parameters/WorkspaceId" }, { $ref: "#/components/parameters/ReviewId" }],
      responses: { "200": jsonSuccess("Correction requested successfully.", { type: "object", required: ["researchItem"], properties: { researchItem: { type: "object", required: ["id", "status"], properties: { id: { type: "string" }, status: { type: "string", enum: ["CORRECTION_NEEDED"] } } } } }), ...adminWorkflowErrors, "409": correctionFeedbackRequiredError, "500": jsonError("Current design assignment invariant failed.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/reviews/{reviewId}/approve": {
    post: {
      tags: ["Reviews"], summary: "Approve the current review", security: [{ cookieAuth: [] }],
      description: "ADMIN only. DESIGN_REVIEW transitions to DESIGN_APPROVED and approval metadata is recorded on the latest review.", parameters: [{ $ref: "#/components/parameters/WorkspaceId" }, { $ref: "#/components/parameters/ReviewId" }],
      responses: { "200": jsonSuccess("Design approved successfully.", { type: "object", required: ["researchItem", "reviewSubmission"], properties: { researchItem: { type: "object", required: ["id", "status"], properties: { id: { type: "string" }, status: { type: "string", enum: ["DESIGN_APPROVED"] } } }, reviewSubmission: { type: "object", required: ["id", "roundNumber", "approvedAt", "approvedById"], properties: { id: { type: "string" }, roundNumber: { type: "integer" }, approvedAt: { type: "string", format: "date-time" }, approvedById: { type: "string" } } } } }), ...adminWorkflowErrors, "500": jsonError("Current design assignment invariant failed.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/annotations/{annotationId}/replies": {
    post: {
      tags: ["Reviews"], summary: "Reply to an annotation", security: [{ cookieAuth: [] }],
      description: "ADMIN may reply; DESIGNER must be the current assignee. Replies are allowed on the latest round while status is DESIGN_REVIEW, CORRECTION_NEEDED, or DESIGN_IN_PROGRESS.",
      parameters: [{ $ref: "#/components/parameters/WorkspaceId" }, { $ref: "#/components/parameters/AnnotationId" }],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["message"], properties: { message: { type: "string", minLength: 1, maxLength: 2000 } } } } } },
      responses: { "201": jsonSuccess("Annotation reply created successfully.", { type: "object", required: ["reply"], properties: { reply: { type: "object", required: ["id", "annotationId", "message", "createdAt", "updatedAt", "createdBy"], properties: { id: { type: "string" }, annotationId: { type: "string" }, message: { type: "string" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, createdBy: { type: "object", required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string", nullable: true } } } } } } }), "400": jsonError("Invalid reply body."), "401": jsonError("Authentication is required."), "403": jsonError("Workspace role or current assignment is insufficient."), "404": jsonError("Annotation was not found."), "409": jsonError("The annotation is not on the current eligible review round.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/annotations/{annotationId}": {
    patch: {
      tags: ["Reviews"], summary: "Edit an owned annotation", security: [{ cookieAuth: [] }],
      description: "Creator only; no ADMIN override. Annotations are immutable after Request Correction, approval, or when their review round is historical.",
      parameters: [{ $ref: "#/components/parameters/WorkspaceId" }, { $ref: "#/components/parameters/AnnotationId" }],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["comment"], properties: { comment: { type: "string", minLength: 1, maxLength: 2000 } } } } } },
      responses: { "200": jsonSuccess("Review annotation updated successfully.", { type: "object", required: ["annotation"], properties: { annotation: { type: "object", required: ["id", "reviewSubmissionId", "x", "y", "comment", "resolved", "createdAt", "updatedAt", "createdBy"], properties: { id: { type: "string" }, reviewSubmissionId: { type: "string" }, x: { type: "number" }, y: { type: "number" }, comment: { type: "string" }, resolved: { type: "boolean" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, createdBy: { type: "object", properties: { id: { type: "string" }, name: { type: "string", nullable: true } } } } } } }), "400": jsonError("Invalid annotation body."), "401": jsonError("Authentication is required."), "403": jsonError("Only the annotation creator may edit it."), "404": jsonError("Annotation was not found in this workspace."), "409": jsonError("Annotation is not on the current DESIGN_REVIEW round.") },
    },
    delete: {
      tags: ["Reviews"], summary: "Delete an owned annotation", security: [{ cookieAuth: [] }],
      description: "Creator only; no ADMIN override. Deletion is blocked when the annotation has replies and is unavailable after Request Correction, approval, or when historical.",
      parameters: [{ $ref: "#/components/parameters/WorkspaceId" }, { $ref: "#/components/parameters/AnnotationId" }],
      responses: { "200": jsonSuccess("Review annotation deleted successfully.", { type: "object", required: ["annotationId"], properties: { annotationId: { type: "string" } } }), "401": jsonError("Authentication is required."), "403": jsonError("Only the annotation creator may delete it."), "404": jsonError("Annotation was not found in this workspace."), "409": jsonError("Annotation is locked or has replies.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/annotations/{annotationId}/replies/{replyId}": {
    patch: {
      tags: ["Reviews"], summary: "Edit an owned annotation reply", security: [{ cookieAuth: [] }],
      description: "ADMIN or current assigned DESIGNER may edit only their own reply. Replies are immutable on historical or terminal rounds.",
      parameters: [{ $ref: "#/components/parameters/WorkspaceId" }, { $ref: "#/components/parameters/AnnotationId" }, { name: "replyId", in: "path", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["message"], properties: { message: { type: "string", minLength: 1, maxLength: 2000 } } } } } },
      responses: { "200": jsonSuccess("Annotation reply updated successfully.", { type: "object", required: ["reply"], properties: { reply: { type: "object", required: ["id", "annotationId", "message", "createdAt", "updatedAt", "createdBy"], properties: { id: { type: "string" }, annotationId: { type: "string" }, message: { type: "string" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, createdBy: { type: "object", properties: { id: { type: "string" }, name: { type: "string", nullable: true } } } } } } }), "400": jsonError("Invalid reply body."), "401": jsonError("Authentication is required."), "403": jsonError("Only the reply creator may edit it."), "404": jsonError("Reply was not found in this workspace annotation."), "409": jsonError("Reply is not on the current eligible review round.") },
    },
    delete: {
      tags: ["Reviews"], summary: "Delete an owned annotation reply", security: [{ cookieAuth: [] }],
      description: "ADMIN or current assigned DESIGNER may delete only their own reply. Replies are immutable on historical or terminal rounds.",
      parameters: [{ $ref: "#/components/parameters/WorkspaceId" }, { $ref: "#/components/parameters/AnnotationId" }, { name: "replyId", in: "path", required: true, schema: { type: "string" } }],
      responses: { "200": jsonSuccess("Annotation reply deleted successfully.", { type: "object", required: ["replyId"], properties: { replyId: { type: "string" } } }), "401": jsonError("Authentication is required."), "403": jsonError("Only the reply creator may delete it."), "404": jsonError("Reply was not found in this workspace annotation."), "409": jsonError("Reply is not on the current eligible review round.") },
    },
  },
};
