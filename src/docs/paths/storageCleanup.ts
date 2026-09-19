import { jsonError, jsonSuccess } from "../components.js";
import { OpenApiPathMap } from "../docs.type.js";

const workspaceParameters = [
  { $ref: "#/components/parameters/WorkspaceId" },
];

const storageCleanupErrors = {
  "400": jsonError("Invalid storage cleanup request."),
  "401": jsonError("Authentication is required."),
  "403": jsonError("Explicit ADMIN role is required."),
};

export const storageCleanupPaths: OpenApiPathMap = {
  "/api/v1/workspaces/{workspaceId}/admin/storage/final-assets": {
    get: {
      tags: ["Storage Cleanup"],
      summary: "List Final ZIP storage cleanup candidates",
      description: "ADMIN only. Returns StoreOps-managed Final ZIP metadata only; storage keys and provider details are never exposed.",
      security: [{ cookieAuth: [] }],
      parameters: [
        ...workspaceParameters,
        { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
        { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
        { name: "search", in: "query", schema: { type: "string", maxLength: 100 }, description: "Searches Etsy listing ID and title." },
        { name: "filter", in: "query", schema: { type: "string", enum: ["ELIGIBLE", "CLEANED", "ALL"], default: "ELIGIBLE" } },
      ],
      responses: {
        "200": jsonSuccess("Final ZIP cleanup candidates retrieved successfully", {
          type: "object",
          required: ["items", "pagination"],
          properties: {
            items: { type: "array", items: { $ref: "#/components/schemas/StorageCleanupCandidate" } },
            pagination: { $ref: "#/components/schemas/Pagination" },
          },
        }),
        ...storageCleanupErrors,
      },
    },
  },
  "/api/v1/workspaces/{workspaceId}/admin/storage/metrics": {
    get: {
      tags: ["Storage Cleanup"],
      summary: "Get Final ZIP storage metrics",
      description: "ADMIN only. Metrics cover StoreOps-managed Final ZIP metadata in this workspace, not Cloudflare account usage.",
      security: [{ cookieAuth: [] }],
      parameters: workspaceParameters,
      responses: {
        "200": jsonSuccess("Final ZIP storage metrics retrieved successfully", { $ref: "#/components/schemas/FinalAssetStorageMetrics" }),
        ...storageCleanupErrors,
      },
    },
  },
  "/api/v1/workspaces/{workspaceId}/admin/storage/final-assets/{finalAssetId}": {
    delete: {
      tags: ["Storage Cleanup"],
      summary: "Clean one listed Final ZIP package",
      description: "ADMIN only. Deletes the verified private object before recording the storage-deletion marker. Already-cleaned packages return success without another storage request.",
      security: [{ cookieAuth: [] }],
      parameters: [
        ...workspaceParameters,
        { name: "finalAssetId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      responses: {
        "200": jsonSuccess("Final ZIP cleanup processed successfully", { $ref: "#/components/schemas/FinalAssetCleanupResult" }),
        ...storageCleanupErrors,
        "404": jsonError("Final asset not found."),
        "409": jsonError("Final asset is not eligible for cleanup."),
        "502": jsonError("Storage removal failed."),
      },
    },
  },
  "/api/v1/workspaces/{workspaceId}/admin/storage/final-assets/bulk-delete": {
    post: {
      tags: ["Storage Cleanup"],
      summary: "Clean up to 100 listed Final ZIP packages",
      description: "ADMIN only. Requests are workspace-scoped and may return mixed results; only provider-confirmed deletions are marked cleaned.",
      security: [{ cookieAuth: [] }],
      parameters: workspaceParameters,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["finalAssetIds"],
              properties: {
                finalAssetIds: {
                  type: "array",
                  minItems: 1,
                  maxItems: 100,
                  items: { type: "string", minLength: 1 },
                },
              },
            },
          },
        },
      },
      responses: {
        "200": jsonSuccess("Final ZIP bulk cleanup processed successfully", { $ref: "#/components/schemas/BulkFinalAssetCleanupResult" }),
        ...storageCleanupErrors,
        "502": jsonError("Storage removal failed before cleanup results were available."),
      },
    },
  },
};
