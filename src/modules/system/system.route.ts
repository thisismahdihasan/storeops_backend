import { Router } from "express";
import { requireCronSecret } from "../../middleware/requireCronSecret.js";
import { catchAsync } from "../../utils/catchAsync.js";
import {
  cleanupFinalAssets,
  cleanupReviewImages,
  cleanupWorkspaces,
} from "./system.controller.js";

const router: Router = Router();

router.post(
  "/cleanup/reviews",
  requireCronSecret,
  catchAsync(cleanupReviewImages)
);

router.post(
  "/cleanup/final-assets",
  requireCronSecret,
  catchAsync(cleanupFinalAssets)
);

router.post(
  "/cleanup/workspaces",
  requireCronSecret,
  catchAsync(cleanupWorkspaces)
);

export const SystemRoutes = router;
export default router;
