import { jsonError, jsonSuccess } from "../components.js";
import { OpenApiPathMap } from "../docs.type.js";

const dashboardParameters = [
  { $ref: "#/components/parameters/WorkspaceId" },
  { name: "preset", in: "query", schema: { $ref: "#/components/schemas/DashboardDatePreset", default: "all" } },
  { name: "dateFrom", in: "query", schema: { type: "string" }, description: "ISO date or date-time. Must be paired with dateTo; required with dateTo for custom preset." },
  { name: "dateTo", in: "query", schema: { type: "string" }, description: "ISO date or date-time. Must be paired with dateFrom; cannot precede dateFrom." },
];

const dashboardErrors = {
  "400": jsonError("Invalid dashboard date range."),
  "401": jsonError("Authentication is required."),
  "403": jsonError("Explicit ADMIN role is required."),
};

const dateRange = {
  type: "object", required: ["preset", "dateFrom", "dateTo"], properties: {
    preset: { $ref: "#/components/schemas/DashboardDatePreset" },
    dateFrom: { type: "string", format: "date-time", nullable: true },
    dateTo: { type: "string", format: "date-time", nullable: true },
  },
};

export const dashboardPaths: OpenApiPathMap = {
  "/api/v1/workspaces/{workspaceId}/admin/dashboard/overview": {
    get: {
      tags: ["Admin Dashboard"], summary: "Get workspace pipeline overview", security: [{ cookieAuth: [] }],
      description: "ADMIN only. Custom ranges require paired ISO date-time values; explicit paired dates take precedence over preset.", parameters: dashboardParameters,
      responses: { "200": jsonSuccess("Dashboard overview retrieved successfully.", { type: "object", required: ["dateRange", "totalResearch", "pipeline"], properties: { dateRange, totalResearch: { type: "integer" }, pipeline: { type: "object", required: ["researched", "assigned", "designInProgress", "designReview", "correctionNeeded", "issueReported", "designApproved", "readyForListing", "listingInProgress", "listed"], properties: { researched: { type: "integer" }, assigned: { type: "integer" }, designInProgress: { type: "integer" }, designReview: { type: "integer" }, correctionNeeded: { type: "integer" }, issueReported: { type: "integer" }, designApproved: { type: "integer" }, readyForListing: { type: "integer" }, listingInProgress: { type: "integer" }, listed: { type: "integer" } } } } }), ...dashboardErrors },
    },
  },
  "/api/v1/workspaces/{workspaceId}/admin/dashboard/researchers": {
    get: {
      tags: ["Admin Dashboard"], summary: "Get researcher performance", security: [{ cookieAuth: [] }], parameters: dashboardParameters,
      responses: { "200": jsonSuccess("Researcher performance retrieved successfully.", { type: "object", required: ["dateRange", "researchers"], properties: { dateRange, researchers: { type: "array", items: { type: "object", required: ["userId", "name", "email", "researchCount"], properties: { userId: { type: "string" }, name: { type: "string", nullable: true }, email: { type: "string", format: "email" }, researchCount: { type: "integer" } } } } } }), ...dashboardErrors },
    },
  },
  "/api/v1/workspaces/{workspaceId}/admin/dashboard/designers": {
    get: {
      tags: ["Admin Dashboard"], summary: "Get designer performance", security: [{ cookieAuth: [] }], parameters: dashboardParameters,
      responses: { "200": jsonSuccess("Designer performance retrieved successfully.", { type: "object", required: ["dateRange", "designers"], properties: { dateRange, designers: { type: "array", items: { type: "object", required: ["userId", "name", "email", "assignedCount", "currentInProgress", "submittedCount", "approvedCount", "correctionsCount", "completedCount"], properties: { userId: { type: "string" }, name: { type: "string", nullable: true }, email: { type: "string", format: "email" }, assignedCount: { type: "integer" }, currentInProgress: { type: "integer" }, submittedCount: { type: "integer" }, approvedCount: { type: "integer" }, correctionsCount: { type: "integer" }, completedCount: { type: "integer" } } } } } }), ...dashboardErrors },
    },
  },
  "/api/v1/workspaces/{workspaceId}/admin/dashboard/listers": {
    get: {
      tags: ["Admin Dashboard"], summary: "Get lister performance", security: [{ cookieAuth: [] }], parameters: dashboardParameters,
      responses: { "200": jsonSuccess("Lister performance retrieved successfully.", { type: "object", required: ["dateRange", "listers"], properties: { dateRange, listers: { type: "array", items: { type: "object", required: ["userId", "name", "email", "assignedCount", "currentInProgress", "listedCount"], properties: { userId: { type: "string" }, name: { type: "string", nullable: true }, email: { type: "string", format: "email" }, assignedCount: { type: "integer" }, currentInProgress: { type: "integer" }, listedCount: { type: "integer" } } } } } }), ...dashboardErrors },
    },
  },
  "/api/v1/workspaces/{workspaceId}/admin/users/{userId}/activity": {
    get: {
      tags: ["Admin Dashboard"], summary: "Get one workspace member's activity", description: "ADMIN only. Current roles describe present workspace permissions. A removed member's historical activity is available only when workspace-scoped historical work records exist; removed members return membershipStatus REMOVED, no current roles, and no membership join date. Research, design, and listing summaries are based on historical work records. Recent Items is a chronological, mixed-role historical activity list independent of current roles.", security: [{ cookieAuth: [] }],
      parameters: [...dashboardParameters, { $ref: "#/components/parameters/UserId" }],
      responses: { "200": jsonSuccess("User activity retrieved successfully.", { type: "object", required: ["dateRange", "user", "summary", "recentItems"], properties: { dateRange, user: { type: "object", required: ["id", "name", "email", "profileImageUrl", "roles", "membershipStatus", "joinedAt"], properties: { id: { type: "string" }, name: { type: "string", nullable: true }, email: { type: "string", format: "email" }, profileImageUrl: { type: "string", format: "uri", nullable: true }, roles: { type: "array", description: "Current workspace roles only. Empty when membershipStatus is REMOVED.", items: { $ref: "#/components/schemas/WorkspaceRole" } }, membershipStatus: { type: "string", enum: ["ACTIVE", "REMOVED"] }, joinedAt: { type: "string", format: "date-time", nullable: true, description: "Current membership join date. Null for removed members." } } }, summary: { type: "object", required: ["research", "design", "listing"], properties: { research: { type: "object", nullable: true, properties: { totalCreated: { type: "integer" } } }, design: { type: "object", nullable: true, properties: { assignedCount: { type: "integer" }, currentInProgress: { type: "integer" }, submittedCount: { type: "integer" }, approvedCount: { type: "integer" }, correctionsCount: { type: "integer" }, completedCount: { type: "integer" } } }, listing: { type: "object", nullable: true, properties: { assignedCount: { type: "integer" }, currentInProgress: { type: "integer" }, listedCount: { type: "integer" } } } } }, recentItems: { type: "array", items: { type: "object", required: ["id", "researchItemId", "title", "status", "activityRole", "activityAt"], properties: { id: { type: "string" }, researchItemId: { type: "string" }, title: { type: "string", nullable: true }, status: { $ref: "#/components/schemas/ResearchStatus" }, activityRole: { type: "string", enum: ["RESEARCHER", "DESIGNER", "LISTER"] }, activityAt: { type: "string", format: "date-time" } } } } } }), ...dashboardErrors, "404": jsonError("User not found in this workspace.") },
    },
  },
};
