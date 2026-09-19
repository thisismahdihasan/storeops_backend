import { openApiComponents } from "./components.js";
import { OpenApiPathMap } from "./docs.type.js";
import { authPaths } from "./paths/auth.js";
import { dashboardPaths } from "./paths/dashboard.js";
import { designerPaths } from "./paths/designer.js";
import { healthPaths } from "./paths/health.js";
import { listingPaths } from "./paths/listing.js";
import { notificationPaths } from "./paths/notifications.js";
import { researchPaths } from "./paths/research.js";
import { reviewPaths } from "./paths/reviews.js";
import { systemPaths } from "./paths/system.js";
import { storageCleanupPaths } from "./paths/storageCleanup.js";
import { openApiTags } from "./tags.js";
import { workspacePaths } from "./paths/workspaces.js";

const paths: OpenApiPathMap = {
  ...authPaths,
  ...workspacePaths,
  ...healthPaths,
  ...researchPaths,
  ...designerPaths,
  ...reviewPaths,
  ...listingPaths,
  ...notificationPaths,
  ...dashboardPaths,
  ...systemPaths,
  ...storageCleanupPaths,
};

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "StoreOps API",
    description: "Internal Etsy/POD production workflow API.",
    version: "1.0.0",
  },
  servers: [{ url: "http://localhost:5000", description: "Local development" }],
  tags: openApiTags,
  paths,
  components: openApiComponents,
};

// The root status route is intentionally omitted because it is not part of the versioned frontend API.
const { "/api/v1/system/cleanup/reviews": internalSystemPath, ...publicPaths } = paths;
void internalSystemPath;

export const swaggerUiDocument = {
  ...openApiDocument,
  paths: publicPaths,
};
