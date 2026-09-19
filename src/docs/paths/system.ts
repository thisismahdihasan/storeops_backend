import { jsonError, jsonSuccess } from "../components.js";
import { OpenApiPathMap } from "../docs.type.js";

export const systemPaths: OpenApiPathMap = {
  "/api/v1/system/cleanup/reviews": {
    post: {
      tags: ["Internal"],
      summary: "Clean up expired review screenshots",
      description:
        "Internal cron endpoint. Send the configured `x-cron-secret` header; this operation is omitted from Swagger UI but retained in the raw spec.",
      parameters: [
        {
          name: "x-cron-secret",
          in: "header",
          required: true,
          schema: { type: "string" },
          description: "Configured secret; never expose or persist it in clients.",
        },
      ],
      responses: {
        "200": jsonSuccess("Review image cleanup completed successfully.", {
          type: "object",
          required: [
            "status",
            "scanned",
            "eligible",
            "deleted",
            "alreadyMissing",
            "failed",
            "failedIds",
            "cutoffDate",
          ],
          properties: {
            status: { type: "string", enum: ["completed", "already_running"] },
            scanned: { type: "integer" },
            eligible: { type: "integer" },
            deleted: { type: "integer" },
            alreadyMissing: { type: "integer" },
            failed: { type: "integer" },
            failedIds: { type: "array", items: { type: "string" } },
            cutoffDate: { type: "string", format: "date-time" },
          },
        }),
        "400": jsonError("Invalid cleanup body."),
        "401": jsonError("Cron secret is invalid or missing."),
        "500": jsonError("Cleanup failed."),
      },
    },
  },
  "/api/v1/system/cleanup/final-assets": {
    post: {
      tags: ["Internal"],
      summary: "Clean up expired final ZIP packages based on workspace retention",
      description:
        "Internal daily cron endpoint. Evaluates workspaces with auto-cleanup enabled and removes final assets past their configured retention cutoff. Send the configured `x-cron-secret` header.",
      parameters: [
        {
          name: "x-cron-secret",
          in: "header",
          required: true,
          schema: { type: "string" },
          description: "Configured secret; never expose or persist it in clients.",
        },
      ],
      responses: {
        "200": jsonSuccess("Final asset auto-cleanup completed successfully", {
          type: "object",
          required: [
            "status",
            "workspacesChecked",
            "workspacesProcessed",
            "eligibleCount",
            "cleanedCount",
            "alreadyCleanedCount",
            "failedCount",
            "reclaimedBytes",
          ],
          properties: {
            status: { type: "string", enum: ["completed", "already_running"] },
            workspacesChecked: { type: "integer" },
            workspacesProcessed: { type: "integer" },
            eligibleCount: { type: "integer" },
            cleanedCount: { type: "integer" },
            alreadyCleanedCount: { type: "integer" },
            failedCount: { type: "integer" },
            reclaimedBytes: { type: "string" },
          },
        }),
        "400": jsonError("Invalid cleanup body."),
        "401": jsonError("Cron secret is invalid or missing."),
        "500": jsonError("Cleanup failed."),
      },
    },
  },
};
