import { jsonError, jsonSuccess } from "../components.js";
import { OpenApiPathMap } from "../docs.type.js";

const itemParameters = [
  { $ref: "#/components/parameters/WorkspaceId" },
  { $ref: "#/components/parameters/ResearchItemId" },
];

const itemStatus = (status: string) => ({
  type: "object", required: ["researchItem"], properties: {
    researchItem: { type: "object", required: ["id", "status"], properties: { id: { type: "string" }, status: { $ref: "#/components/schemas/ResearchStatus", example: status } } },
  },
});

const standardWorkflowErrors = {
  "401": jsonError("Authentication is required."),
  "403": jsonError("Explicit DESIGNER role and current assignment are required."),
  "404": jsonError("Research item was not found."),
  "409": jsonError("The current workflow state does not allow this action."),
};

const designerDetailResponse = {
  type: "object",
  required: [
    "researchItem",
    "researcher",
    "assignment",
    "currentDesigner",
    "latestReview",
    "reviewHistory",
    "latestIssue",
    "finalAssets",
  ],
  properties: {
    researchItem: {
      type: "object",
      required: ["id", "title", "etsyListingId", "originalUrl", "status", "createdAt", "updatedAt"],
      properties: {
        id: { type: "string" },
        title: { type: "string", nullable: true },
        etsyListingId: { type: "string" },
        originalUrl: { type: "string", format: "uri" },
        status: { $ref: "#/components/schemas/ResearchStatus" },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
    researcher: { $ref: "#/components/schemas/CreatedBySummary" },
    assignment: {
      type: "object",
      required: ["id", "assignedAt", "startedAt", "isCurrent"],
      properties: {
        id: { type: "string" },
        assignedAt: { type: "string", format: "date-time" },
        startedAt: { type: "string", format: "date-time", nullable: true },
        isCurrent: { type: "boolean", enum: [true] },
      },
    },
    currentDesigner: { $ref: "#/components/schemas/CreatedBySummary" },
    latestReview: {
      type: "object",
      nullable: true,
      required: ["id", "roundNumber", "imageUrl", "imageDeletedAt", "note", "submittedAt", "approvedAt", "annotations"],
      properties: {
        id: { type: "string" },
        roundNumber: { type: "integer" },
        imageUrl: { type: "string", format: "uri", nullable: true, description: "Always null when imageDeletedAt is set." },
        imageDeletedAt: { type: "string", format: "date-time", nullable: true },
        note: { type: "string", nullable: true },
        submittedAt: { type: "string", format: "date-time" },
        approvedAt: { type: "string", format: "date-time", nullable: true },
        annotations: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "x", "y", "comment", "resolved", "createdAt", "updatedAt", "createdBy", "replies"],
            properties: {
              id: { type: "string" }, x: { type: "number" }, y: { type: "number" },
              comment: { type: "string" }, resolved: { type: "boolean" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
              createdBy: { type: "object", required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string", nullable: true } } },
              replies: { type: "array", items: { type: "object", required: ["id", "message", "createdAt", "updatedAt", "createdBy"], properties: { id: { type: "string" }, message: { type: "string" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, createdBy: { type: "object", required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string", nullable: true } } } } } },
            },
          },
        },
      },
    },
    latestIssue: {
      type: "object",
      nullable: true,
      required: ["id", "reason", "details", "createdAt"],
      properties: {
        id: { type: "string" }, reason: { $ref: "#/components/schemas/IssueReason" },
        details: { type: "string", nullable: true }, createdAt: { type: "string", format: "date-time" },
      },
    },
    reviewHistory: {
      type: "object",
      required: ["previousReviews"],
      properties: {
        previousReviews: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "roundNumber", "imageUrl", "imageDeletedAt", "note", "submittedAt", "annotations"],
            properties: {
              id: { type: "string" },
              roundNumber: { type: "integer" },
              imageUrl: { type: "string", format: "uri", nullable: true, description: "Always null when imageDeletedAt is set." },
              imageDeletedAt: { type: "string", format: "date-time", nullable: true },
              note: { type: "string", nullable: true },
              submittedAt: { type: "string", format: "date-time" },
              annotations: {
                type: "array",
                items: {
                  type: "object",
                  required: ["id", "x", "y", "comment", "createdAt", "updatedAt", "createdBy", "replies"],
                  properties: {
                    id: { type: "string" }, x: { type: "number" }, y: { type: "number" },
                    comment: { type: "string" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
                    createdBy: { type: "object", required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string", nullable: true } } },
                    replies: { type: "array", items: { type: "object", required: ["id", "message", "createdAt", "updatedAt", "createdBy"], properties: { id: { type: "string" }, message: { type: "string" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, createdBy: { type: "object", required: ["id", "name"], properties: { id: { type: "string" }, name: { type: "string", nullable: true } } } } } },
                  },
                },
              },
            },
          },
        },
      },
    },
    finalAssets: {
      type: "object",
      required: ["count", "items"],
      properties: {
        count: { type: "integer", minimum: 0 },
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "fileName", "fileSize", "mimeType", "uploadedAt"],
            properties: {
              id: { type: "string" }, fileName: { type: "string" },
              fileSize: { type: "string", description: "Decimal byte count." },
              mimeType: { type: "string" }, uploadedAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
  },
};

export const designerPaths: OpenApiPathMap = {
  "/api/v1/workspaces/{workspaceId}/design": {
    get: {
      tags: ["Designer"],
      summary: "Get workspace design operations inventory",
      security: [{ cookieAuth: [] }],
      description: "ADMIN only. Operational management list of all research items across design workflow stages. Supports filtering by designerId, status, date, and search query.",
      parameters: [
        { $ref: "#/components/parameters/WorkspaceId" },
        { $ref: "#/components/parameters/Page" },
        { $ref: "#/components/parameters/Limit" },
        { name: "designerId", in: "query", schema: { type: "string" }, description: "Filter items assigned to or worked on by this designer." },
        {
          name: "status",
          in: "query",
          schema: {
            type: "string",
            enum: [
              "ASSIGNED",
              "DESIGN_IN_PROGRESS",
              "DESIGN_REVIEW",
              "CORRECTION_NEEDED",
              "ISSUE_REPORTED",
              "DESIGN_APPROVED",
              "READY_FOR_LISTING",
              "LISTING_IN_PROGRESS",
              "LISTED",
            ],
          },
          description: "Workflow status filter.",
        },
        { name: "date", in: "query", schema: { type: "string", format: "date", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, description: "Filter items created on this date (YYYY-MM-DD)." },
        { name: "search", in: "query", schema: { type: "string", maxLength: 100 }, description: "Search by title or Etsy listing ID." },
      ],
      responses: {
        "200": jsonSuccess("Admin designs retrieved successfully", {
          type: "object",
          required: ["items", "pagination"],
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "id",
                  "etsyListingId",
                  "title",
                  "originalUrl",
                  "normalizedUrl",
                  "referenceImageUrl",
                  "status",
                  "currentAssignment",
                  "currentDesigner",
                  "latestReview",
                  "latestIssueReport",
                  "createdAt",
                  "updatedAt",
                ],
                properties: {
                  id: { type: "string" },
                  etsyListingId: { type: "string" },
                  title: { type: "string", nullable: true },
                  originalUrl: { type: "string", format: "uri" },
                  normalizedUrl: { type: "string", format: "uri" },
                  referenceImageUrl: { type: "string", format: "uri", nullable: true },
                  status: { $ref: "#/components/schemas/ResearchStatus" },
                  currentAssignment: {
                    type: "object",
                    nullable: true,
                    required: ["id", "assignedAt", "startedAt", "completedAt"],
                    properties: {
                      id: { type: "string" },
                      assignedAt: { type: "string", format: "date-time" },
                      startedAt: { type: "string", format: "date-time", nullable: true },
                      completedAt: { type: "string", format: "date-time", nullable: true },
                    },
                  },
                  currentDesigner: {
                    type: "object",
                    nullable: true,
                    required: ["id", "name", "email", "profileImageUrl"],
                    properties: {
                      id: { type: "string" },
                      name: { type: "string", nullable: true },
                      email: { type: "string", format: "email" },
                      profileImageUrl: { type: "string", format: "uri", nullable: true },
                    },
                  },
                  latestReview: {
                    type: "object",
                    nullable: true,
                    required: ["id", "roundNumber", "submittedAt", "approvedAt"],
                    properties: {
                      id: { type: "string" },
                      roundNumber: { type: "integer" },
                      submittedAt: { type: "string", format: "date-time" },
                      approvedAt: { type: "string", format: "date-time", nullable: true },
                    },
                  },
                  latestIssueReport: {
                    type: "object",
                    nullable: true,
                    required: ["id", "reason", "details", "createdAt"],
                    properties: {
                      id: { type: "string" },
                      reason: { type: "string" },
                      details: { type: "string", nullable: true },
                      createdAt: { type: "string", format: "date-time" },
                    },
                  },
                  createdAt: { type: "string", format: "date-time" },
                  updatedAt: { type: "string", format: "date-time" },
                },
              },
            },
            pagination: { $ref: "#/components/schemas/Pagination" },
          },
        }),
        "400": jsonError("Invalid query parameters."),
        "401": jsonError("Authentication is required."),
        "403": jsonError("Explicit ADMIN role is required."),
      },
    },
  },
  "/api/v1/workspaces/{workspaceId}/designer/my-work": {
    get: {
      tags: ["Designer"], summary: "Get the current designer's active queue", security: [{ cookieAuth: [] }],
      description: "DESIGNER only. The default queue and status filter support only ASSIGNED, DESIGN_IN_PROGRESS, DESIGN_REVIEW, CORRECTION_NEEDED, ISSUE_REPORTED, and DESIGN_APPROVED.",
      parameters: [
        { $ref: "#/components/parameters/WorkspaceId" }, { $ref: "#/components/parameters/Page" }, { $ref: "#/components/parameters/Limit" },
        { name: "search", in: "query", schema: { type: "string" } },
        { name: "status", in: "query", schema: { type: "string", enum: ["ASSIGNED", "DESIGN_IN_PROGRESS", "DESIGN_REVIEW", "CORRECTION_NEEDED", "ISSUE_REPORTED", "DESIGN_APPROVED"] } },
      ],
      responses: { "200": jsonSuccess("Designer work queue retrieved successfully.", { type: "object", required: ["items", "pagination"], properties: { items: { type: "array", items: { type: "object", required: ["assignmentId", "assignedAt", "startedAt", "researchItem"], properties: { assignmentId: { type: "string" }, assignedAt: { type: "string", format: "date-time" }, startedAt: { type: "string", format: "date-time", nullable: true }, researchItem: { allOf: [{ $ref: "#/components/schemas/ResearchItemSafe" }, { type: "object", required: ["createdBy"], properties: { createdBy: { $ref: "#/components/schemas/CreatedBySummary" } } }] } } } }, pagination: { $ref: "#/components/schemas/Pagination" } } }), "400": jsonError("Invalid queue query."), "401": jsonError("Authentication is required."), "403": jsonError("Explicit DESIGNER role is required.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/design/{researchItemId}": {
    get: {
      tags: ["Designer"], summary: "Get current designer-owned work detail", security: [{ cookieAuth: [] }],
      description: "Explicit DESIGNER role and current-assignment ownership are both required. ADMIN alone does not grant access; an ADMIN plus DESIGNER user must still be the current assigned designer. The response includes only safe final-asset metadata and never includes storage keys, buckets, provider URLs, or signed URLs. The latest review is selected by descending roundNumber; its imageUrl is null when imageDeletedAt is set.",
      parameters: itemParameters,
      responses: { "200": jsonSuccess("Design detail retrieved successfully.", designerDetailResponse), "401": jsonError("Authentication is required."), "403": jsonError("Explicit DESIGNER role and current assignment are required."), "404": jsonError("Research item was not found.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/design/{researchItemId}/start": {
    post: {
      tags: ["Designer"], summary: "Start assigned design work", security: [{ cookieAuth: [] }],
      description: "Current assigned designer starts an ASSIGNED item, transitioning it to DESIGN_IN_PROGRESS. A newly reassigned current designer may also start an already DESIGN_IN_PROGRESS item without changing its status.", parameters: itemParameters,
      responses: { "200": jsonSuccess("Design work started successfully.", { allOf: [itemStatus("DESIGN_IN_PROGRESS"), { type: "object", required: ["assignment"], properties: { assignment: { type: "object", required: ["id", "designerId", "startedAt", "isCurrent"], properties: { id: { type: "string" }, designerId: { type: "string" }, startedAt: { type: "string", format: "date-time" }, isCurrent: { type: "boolean" } } } } }] }), ...standardWorkflowErrors },
    },
  },
  "/api/v1/workspaces/{workspaceId}/design/{researchItemId}/report-issue": {
    post: {
      tags: ["Designer"], summary: "Report a design issue", security: [{ cookieAuth: [] }],
      description: "Current assigned designer only. ASSIGNED or DESIGN_IN_PROGRESS transitions to ISSUE_REPORTED.", parameters: itemParameters,
      requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["reason"], properties: { reason: { $ref: "#/components/schemas/IssueReason" }, details: { type: "string", maxLength: 1000 } } } } } },
      responses: { "200": jsonSuccess("Design issue reported successfully.", { allOf: [itemStatus("ISSUE_REPORTED"), { type: "object", required: ["issueReport"], properties: { issueReport: { type: "object", required: ["id", "reason", "details", "createdAt"], properties: { id: { type: "string" }, reason: { $ref: "#/components/schemas/IssueReason" }, details: { type: "string", nullable: true }, createdAt: { type: "string", format: "date-time" } } } } }] }), "400": jsonError("Invalid issue report body."), ...standardWorkflowErrors, "500": jsonError("Issue notification invariant failed.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/design/{researchItemId}/review": {
    post: {
      tags: ["Designer"], summary: "Submit a design review image", security: [{ cookieAuth: [] }],
      description: "Current assigned designer only. DESIGN_IN_PROGRESS transitions to DESIGN_REVIEW. The backend verifies the uploaded binary signature.", parameters: itemParameters,
      requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["image"], properties: { image: { type: "string", format: "binary", description: "Exactly one JPEG, PNG, or WebP image; maximum 10 MB." }, note: { type: "string", maxLength: 2000 } } }, encoding: { image: { contentType: "image/jpeg, image/png, image/webp" } } } } },
      responses: { "200": jsonSuccess("Design submitted for review successfully.", { allOf: [itemStatus("DESIGN_REVIEW"), { type: "object", required: ["reviewSubmission"], properties: { reviewSubmission: { type: "object", required: ["id", "roundNumber", "imageUrl", "imageDeletedAt", "note", "submittedAt"], properties: { id: { type: "string" }, roundNumber: { type: "integer" }, imageUrl: { type: "string", format: "uri", nullable: true }, imageDeletedAt: { type: "string", format: "date-time", nullable: true }, note: { type: "string", nullable: true }, submittedAt: { type: "string", format: "date-time" } } } } }] }), "400": jsonError("Invalid image, note, file count, or 10 MB limit."), ...standardWorkflowErrors, "500": jsonError("Review upload or notification failed.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/design/{researchItemId}/start-correction": {
    post: {
      tags: ["Designer"], summary: "Start a requested correction", security: [{ cookieAuth: [] }],
      description: "Current assigned designer only. CORRECTION_NEEDED transitions to DESIGN_IN_PROGRESS.", parameters: itemParameters,
      responses: { "200": jsonSuccess("Design correction started successfully.", itemStatus("DESIGN_IN_PROGRESS")), ...standardWorkflowErrors },
    },
  },
  "/api/v1/workspaces/{workspaceId}/design/{researchItemId}/final-assets": {
    post: {
      tags: ["Designer"], summary: "Upload private final production assets", security: [{ cookieAuth: [] }],
      description: "Current assigned designer only, after DESIGN_APPROVED. Send 1–10 files on `files`; singular `file` is accepted as a compatibility alias. MIME pairings: ZIP application/zip, application/x-zip-compressed, or application/octet-stream; PNG image/png; JPG/JPEG image/jpeg; WebP image/webp; PDF application/pdf. No storage key or R2 details are returned.", parameters: itemParameters,
      requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["files"], properties: { files: { type: "array", minItems: 1, maxItems: 10, items: { type: "string", format: "binary", description: "Allowed: .zip, .png, .jpg, .jpeg, .webp, .pdf. Maximum 100 MB per file." } } } } } } },
      responses: { "200": jsonSuccess("Final assets uploaded successfully.", { type: "object", required: ["researchItem", "finalAssets"], properties: { researchItem: { type: "object", required: ["id", "status"], properties: { id: { type: "string" }, status: { $ref: "#/components/schemas/ResearchStatus" } } }, finalAssets: { type: "array", items: { $ref: "#/components/schemas/SafeFinalAsset" } } } }), "400": jsonError("Invalid final asset type, MIME pairing, field, count, or file size."), ...standardWorkflowErrors, "502": jsonError("Private storage upload failed."), "500": jsonError("Final asset persistence invariant failed.") },
    },
  },
  "/api/v1/workspaces/{workspaceId}/design/{researchItemId}/complete": {
    post: {
      tags: ["Designer"], summary: "Complete approved design work", security: [{ cookieAuth: [] }],
      description: "Current assigned designer only. Requires DESIGN_APPROVED, an approved latest review, and final assets; transitions to READY_FOR_LISTING and auto-assigns an eligible least-loaded lister when available.", parameters: itemParameters,
      responses: { "200": jsonSuccess("Design completed and marked ready for listing successfully.", { allOf: [itemStatus("READY_FOR_LISTING"), { type: "object", required: ["finalAssetCount", "completedAt"], properties: { finalAssetCount: { type: "integer" }, completedAt: { type: "string", format: "date-time" } } }] }), ...standardWorkflowErrors, "500": jsonError("Approval invariant failed.") },
    },
  },
};
