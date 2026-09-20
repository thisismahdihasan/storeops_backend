import express, { Express, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import router from "./routes/index.js";
import { notFound } from "./middleware/notFound.js";
import { globalErrorHandler } from "./middleware/globalErrorHandler.js";
import { ApiResponse } from "./shared/ApiResponse.js";
import { env } from "./config/env.js";
import { DocsRoutes } from "./docs/docs.route.js";

const app: Express = express();

// Trust exactly one upstream proxy hop.
// In production: cloudflared connects to Express over localhost:5000 (loopback).
// Cloudflare sets X-Forwarded-For to the real client IP before cloudflared forwards it.
// Setting trust proxy = 1 tells Express to trust that single loopback hop, so req.ip
// and express-rate-limit resolve the real client IP rather than 127.0.0.1.
// Using `true` would be unnecessarily permissive; `1` is the minimum safe value here.
app.set("trust proxy", 1);

// 1. Helmet for security headers
app.use(helmet());

const allowedFrontendOrigins = new Set(env.FRONTEND_URLS);

// 2. CORS with exact environment-driven frontend origins and credentials enabled
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedFrontendOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
  })
);

// 3. Request body parsers with 1mb limits
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// 4. Cookie parser
app.use(cookieParser());

// 5. Routes
app.get("/", (_req: Request, res: Response) => {
  ApiResponse.success(res, {
    message: "StoreOps backend is running",
  });
});

// Central API router
app.use("/api/v1", router);
app.use(DocsRoutes);

// 6. 404 handler
app.use(notFound);

// 7. Global error handler
app.use(globalErrorHandler);

export default app;
