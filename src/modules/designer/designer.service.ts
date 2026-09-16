import fs from "node:fs";
import { Prisma, ResearchStatus, WorkspaceRole } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import { ApiError } from "../../shared/ApiError.js";
import {
  ADMIN_DESIGN_WORKFLOW_STATUSES,
  DESIGNER_QUEUE_ACTIVE_STATUSES,
  GetAdminDesignListQueryInput,
  GetDesignerWorkQueueQueryInput,
  MAX_FINAL_ASSET_FILES,
  ReportDesignIssueBodyInput,
  validateFinalAssetFile,
} from "./designer.validation.js";
import {
  AdminDesignListItem,
  AdminDesignListResult,
  DesignerWorkQueueItem,
  DesignerWorkQueueResult,
  FinalAssetIncomingFile,
  NOTIFICATION_TYPE_DESIGN_ISSUE_REPORTED,
  NOTIFICATION_TYPE_DESIGN_REVIEW_SUBMITTED,
  ReportDesignIssueResult,
  StartDesignWorkResult,
  SubmitDesignReviewResult,
  StartCorrectionResult,
  UploadFinalAssetsResult,
  CompleteDesignResult,
} from "./designer.type.js";
import { DesignerDetailResult } from "./designer.detail.type.js";
import {
  ReviewImageDestroyer,
  ReviewImageUploadInput,
  ReviewImageUploader,
  deleteTemporaryReviewImage,
  uploadTemporaryReviewImage,
} from "./designer.review-storage.js";
import { assignLeastWorkloadLister } from "../listing/listing.assignment.js";
import {
  buildFinalAssetKey,
  deleteObject,
  uploadObject,
  UploadObjectInput,
} from "../storage/r2.js";
import { acquireWorkspaceMemberMutationLock } from "../workspace/workspace.member-lock.js";

type FinalAssetStorageOperations = {
  upload: (input: UploadObjectInput) => Promise<void>;
  remove: (storageKey: string) => Promise<void>;
};

const r2FinalAssetStorage: FinalAssetStorageOperations = {
  upload: uploadObject,
  remove: deleteObject,
};

type UploadedFinalAsset = {
  storageKey: string;
  fileName: string;
  fileSize: bigint;
  mimeType: string;
};

const rollbackUploadedFinalAssets = async (
  uploadedAssets: readonly UploadedFinalAsset[],
  removeObject: FinalAssetStorageOperations["remove"]
): Promise<void> => {
  for (const asset of uploadedAssets) {
    try {
      await removeObject(asset.storageKey);
    } catch {
      console.error("Failed to remove uploaded final asset during rollback");
    }
  }
};

export const safeDesignerWorkQueueSelect = {
  id: true,
  assignedAt: true,
  startedAt: true,
  researchItem: {
    select: {
      id: true,
      etsyListingId: true,
      originalUrl: true,
      normalizedUrl: true,
      title: true,
      referenceImageUrl: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  },
} as const;

const safeDesignerDetailSelect = Prisma.validator<Prisma.ResearchItemSelect>()({
  id: true,
  etsyListingId: true,
  originalUrl: true,
  title: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  designAssignments: {
    where: { isCurrent: true },
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      id: true,
      designerId: true,
      assignedAt: true,
      startedAt: true,
      isCurrent: true,
      designer: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  },
  reviewSubmissions: {
    orderBy: [{ roundNumber: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      id: true,
      roundNumber: true,
      imageUrl: true,
      imageDeletedAt: true,
      note: true,
      submittedAt: true,
      approvedAt: true,
      annotations: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          x: true,
          y: true,
          comment: true,
          resolved: true,
          createdAt: true,
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
          replies: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              message: true,
              createdAt: true,
              createdBy: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  },
  issueReports: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      id: true,
      reason: true,
      details: true,
      createdAt: true,
    },
  },
  finalAssets: {
    orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      uploadedAt: true,
    },
  },
});

// Returns a designer-owned detail contract after enforcing current assignment ownership.
export const getDesignDetail = async (
  workspaceId: string,
  researchItemId: string,
  designerId: string
): Promise<DesignerDetailResult> => {
  const researchItem = await prisma.researchItem.findFirst({
    where: {
      id: researchItemId,
      workspaceId,
    },
    select: safeDesignerDetailSelect,
  });

  if (!researchItem) {
    throw new ApiError(404, "Research item not found");
  }

  const assignment = researchItem.designAssignments[0];
  if (!assignment || assignment.designerId !== designerId) {
    throw new ApiError(403, "You are not assigned to this research item");
  }

  const latestReview = researchItem.reviewSubmissions[0] ?? null;
  const latestIssue = researchItem.issueReports[0] ?? null;

  return {
    researchItem: {
      id: researchItem.id,
      title: researchItem.title,
      etsyListingId: researchItem.etsyListingId,
      originalUrl: researchItem.originalUrl,
      status: researchItem.status,
      createdAt: researchItem.createdAt,
      updatedAt: researchItem.updatedAt,
    },
    researcher: researchItem.createdBy,
    assignment: {
      id: assignment.id,
      assignedAt: assignment.assignedAt,
      startedAt: assignment.startedAt,
      isCurrent: true,
    },
    currentDesigner: assignment.designer,
    latestReview: latestReview
      ? {
          id: latestReview.id,
          roundNumber: latestReview.roundNumber,
          imageUrl:
            latestReview.imageDeletedAt === null
              ? latestReview.imageUrl
              : null,
          imageDeletedAt: latestReview.imageDeletedAt,
          note: latestReview.note,
          submittedAt: latestReview.submittedAt,
          approvedAt: latestReview.approvedAt,
          annotations: latestReview.annotations,
        }
      : null,
    latestIssue,
    finalAssets: {
      count: researchItem.finalAssets.length,
      items: researchItem.finalAssets.map((asset) => ({
        id: asset.id,
        fileName: asset.fileName,
        fileSize: asset.fileSize.toString(),
        mimeType: asset.mimeType,
        uploadedAt: asset.uploadedAt,
      })),
    },
  };
};

// Retrieves current active design assignments for the authenticated designer in a workspace.
export const getDesignerWorkQueue = async (
  workspaceId: string,
  designerId: string,
  query: GetDesignerWorkQueueQueryInput
): Promise<DesignerWorkQueueResult> => {
  const { page, limit, status, search } = query;

  const researchItemWhere: Prisma.ResearchItemWhereInput = {
    workspaceId,
    status: status ? status : { in: [...DESIGNER_QUEUE_ACTIVE_STATUSES] },
  };

  if (search) {
    researchItemWhere.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { etsyListingId: { contains: search, mode: "insensitive" } },
      { normalizedUrl: { contains: search, mode: "insensitive" } },
      { originalUrl: { contains: search, mode: "insensitive" } },
    ];
  }

  const where: Prisma.DesignAssignmentWhereInput = {
    designerId,
    isCurrent: true,
    researchItem: researchItemWhere,
  };

  const skip = (page - 1) * limit;

  const [assignments, total] = await prisma.$transaction([
    prisma.designAssignment.findMany({
      where,
      select: safeDesignerWorkQueueSelect,
      orderBy: [
        { assignedAt: "desc" },
        { id: "desc" },
      ],
      skip,
      take: limit,
    }),
    prisma.designAssignment.count({ where }),
  ]);

  const items: DesignerWorkQueueItem[] = assignments.map((assignment) => ({
    assignmentId: assignment.id,
    assignedAt: assignment.assignedAt,
    startedAt: assignment.startedAt,
    researchItem: assignment.researchItem,
  }));

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
};

// Atomically transitions an assigned research item to in-progress and sets startedAt on the current assignment.
export const startDesignWork = async (
  workspaceId: string,
  researchItemId: string,
  designerId: string
): Promise<StartDesignWorkResult> => {
  return await prisma.$transaction(async (tx) => {
    // 1. Scoped lookup by item ID and workspace ID
    const researchItem = await tx.researchItem.findFirst({
      where: {
        id: researchItemId,
        workspaceId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!researchItem) {
      throw new ApiError(404, "Research item not found");
    }

    // 2. Fetch current assignment
    const currentAssignment = await tx.designAssignment.findFirst({
      where: {
        researchItemId,
        isCurrent: true,
      },
      select: {
        id: true,
        designerId: true,
        startedAt: true,
        isCurrent: true,
      },
    });

    if (!currentAssignment) {
      throw new ApiError(409, "No active assignment found for this research item");
    }

    // 3. Verify designer ownership of the current assignment
    if (currentAssignment.designerId !== designerId) {
      throw new ApiError(403, "You are not assigned to this research item");
    }

    // 4. Double-start protection: startedAt already populated on this assignment
    if (currentAssignment.startedAt !== null) {
      throw new ApiError(409, "Design work has already been started");
    }

    // 5. Status validation: allowed for ASSIGNED (first start) or DESIGN_IN_PROGRESS (reassigned start)
    if (
      researchItem.status !== ResearchStatus.ASSIGNED &&
      researchItem.status !== ResearchStatus.DESIGN_IN_PROGRESS
    ) {
      throw new ApiError(
        409,
        `Cannot start design work for an item with status ${researchItem.status}`
      );
    }

    const now = new Date();

    // 6. If status is ASSIGNED, conditionally transition to DESIGN_IN_PROGRESS
    if (researchItem.status === ResearchStatus.ASSIGNED) {
      const updatedItemResult = await tx.researchItem.updateMany({
        where: {
          id: researchItemId,
          workspaceId,
          status: ResearchStatus.ASSIGNED,
        },
        data: {
          status: ResearchStatus.DESIGN_IN_PROGRESS,
          updatedAt: now,
        },
      });

      if (updatedItemResult.count === 0) {
        throw new ApiError(409, "Design work has already been started");
      }
    }

    // 7. Conditional atomic update on DesignAssignment
    const updatedAssignmentResult = await tx.designAssignment.updateMany({
      where: {
        id: currentAssignment.id,
        researchItemId,
        designerId,
        isCurrent: true,
        startedAt: null,
      },
      data: {
        startedAt: now,
      },
    });

    if (updatedAssignmentResult.count !== 1) {
      throw new ApiError(409, "Design work has already been started");
    }

    return {
      researchItem: {
        id: researchItem.id,
        status: ResearchStatus.DESIGN_IN_PROGRESS,
      },
      assignment: {
        id: currentAssignment.id,
        designerId: currentAssignment.designerId,
        startedAt: now,
        isCurrent: true,
      },
    };
  },
  {
    maxWait: 10000,
    timeout: 15000,
  });
};

// Atomically transitions an assigned research item to ISSUE_REPORTED and records a designer issue report.
export const reportAssignedDesignIssue = async (
  workspaceId: string,
  researchItemId: string,
  designerId: string,
  input: ReportDesignIssueBodyInput
): Promise<ReportDesignIssueResult> => {
  return await prisma.$transaction(async (tx) => {
    // 1. Scoped lookup by item ID and workspace ID
    const researchItem = await tx.researchItem.findFirst({
      where: {
        id: researchItemId,
        workspaceId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (!researchItem) {
      throw new ApiError(404, "Research item not found");
    }

    // 2. Fetch current assignment
    const currentAssignment = await tx.designAssignment.findFirst({
      where: {
        researchItemId,
        isCurrent: true,
      },
      select: {
        id: true,
        designerId: true,
        isCurrent: true,
      },
    });

    if (!currentAssignment) {
      throw new ApiError(409, "No active assignment found for this research item");
    }

    // 3. Verify designer ownership of current assignment
    if (currentAssignment.designerId !== designerId) {
      throw new ApiError(403, "You are not assigned to this research item");
    }

    // 4. Status validation: allowed ONLY from ASSIGNED or DESIGN_IN_PROGRESS
    if (
      researchItem.status !== ResearchStatus.ASSIGNED &&
      researchItem.status !== ResearchStatus.DESIGN_IN_PROGRESS
    ) {
      throw new ApiError(
        409,
        `Cannot report an issue for research item with status ${researchItem.status}`
      );
    }

    const now = new Date();

    // 5. Conditional atomic update on ResearchItem status
    // Serializes concurrent requests on the ResearchItem row
    const updatedItemResult = await tx.researchItem.updateMany({
      where: {
        id: researchItemId,
        workspaceId,
        status: {
          in: [ResearchStatus.ASSIGNED, ResearchStatus.DESIGN_IN_PROGRESS],
        },
      },
      data: {
        status: ResearchStatus.ISSUE_REPORTED,
        updatedAt: now,
      },
    });

    if (updatedItemResult.count !== 1) {
      throw new ApiError(
        409,
        "Issue has already been reported or item status has changed"
      );
    }

    // 6. Post-lock re-check: verify current assignment is STILL owned by this designer
    // If concurrent admin reassignment committed before this update, isCurrent became false
    const stillCurrentAssignment = await tx.designAssignment.findFirst({
      where: {
        id: currentAssignment.id,
        researchItemId,
        designerId,
        isCurrent: true,
      },
      select: {
        id: true,
      },
    });

    if (!stillCurrentAssignment) {
      throw new ApiError(403, "You are not assigned to this research item");
    }

    // 7. Create IssueReport atomically
    const issueReport = await tx.issueReport.create({
      data: {
        researchItemId,
        reportedById: designerId,
        reason: input.reason,
        details: input.details ?? null,
      },
      select: {
        id: true,
        reason: true,
        details: true,
        createdAt: true,
      },
    });

    // 8. Find all ADMIN members in the same workspace to receive in-app notifications
    const adminMembers = await tx.workspaceMember.findMany({
      where: {
        workspaceId,
        roles: {
          has: WorkspaceRole.ADMIN,
        },
      },
      select: {
        userId: true,
      },
    });

    if (adminMembers.length === 0) {
      throw new ApiError(
        500,
        "No workspace administrator found to receive issue notification"
      );
    }

    // 9. Atomically create notifications for all admin recipients
    await tx.notification.createMany({
      data: adminMembers.map((admin) => ({
        workspaceId,
        userId: admin.userId,
        type: NOTIFICATION_TYPE_DESIGN_ISSUE_REPORTED,
        title: "Design Issue Reported",
        message: `A designer reported an issue (${input.reason}) on a research item`,
        researchItemId,
      })),
    });

    return {
      researchItem: {
        id: researchItem.id,
        status: ResearchStatus.ISSUE_REPORTED,
      },
      issueReport,
    };
  },
  {
    maxWait: 10000,
    timeout: 15000,
  });
};

// Atomically transitions an in-progress research item to DESIGN_REVIEW, records a ReviewSubmission, and notifies workspace admins.
export const submitAssignedDesignReview = async (
  workspaceId: string,
  researchItemId: string,
  designerId: string,
  imageInput: ReviewImageUploadInput,
  note?: string,
  uploader?: ReviewImageUploader,
  destroyer?: ReviewImageDestroyer
): Promise<SubmitDesignReviewResult> => {
  // 1. Pre-upload state check (optimization before external upload)
  const precheckItem = await prisma.researchItem.findFirst({
    where: {
      id: researchItemId,
      workspaceId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!precheckItem) {
    throw new ApiError(404, "Research item not found");
  }

  if (precheckItem.status !== ResearchStatus.DESIGN_IN_PROGRESS) {
    throw new ApiError(
      409,
      `Cannot submit review for research item with status ${precheckItem.status}`
    );
  }

  const precheckAssignment = await prisma.designAssignment.findFirst({
    where: {
      researchItemId,
      isCurrent: true,
    },
    select: {
      id: true,
      designerId: true,
      startedAt: true,
    },
  });

  if (!precheckAssignment) {
    throw new ApiError(409, "No active assignment found for this research item");
  }

  if (precheckAssignment.designerId !== designerId) {
    throw new ApiError(403, "You are not assigned to this research item");
  }

  if (precheckAssignment.startedAt === null) {
    throw new ApiError(409, "Design work has not been started");
  }

  // 2. Upload review screenshot to Cloudinary (MUST occur OUTSIDE DB transaction)
  const uploadedImage = await uploadTemporaryReviewImage(imageInput, uploader);

  // 3. Authoritative DB transaction with rollback cleanup
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Step A: Conditional status transition gate
        const updatedItemResult = await tx.researchItem.updateMany({
          where: {
            id: researchItemId,
            workspaceId,
            status: ResearchStatus.DESIGN_IN_PROGRESS,
          },
          data: {
            status: ResearchStatus.DESIGN_REVIEW,
            updatedAt: new Date(),
          },
        });

        if (updatedItemResult.count !== 1) {
          throw new ApiError(
            409,
            "Research item is not in DESIGN_IN_PROGRESS status or has already been submitted for review"
          );
        }

        // Step B: Post-gate assignment re-check to protect reassign race
        const stillCurrentAssignment = await tx.designAssignment.findFirst({
          where: {
            researchItemId,
            designerId,
            isCurrent: true,
          },
          select: {
            id: true,
            startedAt: true,
          },
        });

        if (!stillCurrentAssignment) {
          throw new ApiError(403, "You are not assigned to this research item");
        }

        if (stillCurrentAssignment.startedAt === null) {
          throw new ApiError(409, "Design work has not been started");
        }

        // Step C: Calculate server-side round number (latest existing round + 1)
        const latestSubmission = await tx.reviewSubmission.findFirst({
          where: { researchItemId },
          orderBy: { roundNumber: "desc" },
          select: { roundNumber: true },
        });

        const roundNumber = (latestSubmission?.roundNumber ?? 0) + 1;

        // Step D: Create ReviewSubmission record
        const normalizedNote = note?.trim() || null;
        const reviewSubmission = await tx.reviewSubmission.create({
          data: {
            researchItemId,
            designerId,
            roundNumber,
            imageUrl: uploadedImage.secureUrl,
            imagePublicId: uploadedImage.publicId,
            note: normalizedNote,
          },
          select: {
            id: true,
            roundNumber: true,
            imageUrl: true,
            imageDeletedAt: true,
            note: true,
            submittedAt: true,
          },
        });

        // Step E: Query all ADMIN members of the same workspace
        const adminMembers = await tx.workspaceMember.findMany({
          where: {
            workspaceId,
            roles: {
              has: WorkspaceRole.ADMIN,
            },
          },
          select: {
            userId: true,
          },
        });

        if (adminMembers.length === 0) {
          throw new ApiError(
            500,
            "No workspace administrator found to receive review notification"
          );
        }

        // Step F: Fetch designer display name minimally for human notification message
        const designerUser = await tx.user.findUnique({
          where: { id: designerId },
          select: { name: true },
        });

        const designerDisplayName = designerUser?.name?.trim() || "A designer";

        // Step G: Create in-app notifications for all workspace admins
        await tx.notification.createMany({
          data: adminMembers.map((admin) => ({
            workspaceId,
            userId: admin.userId,
            type: NOTIFICATION_TYPE_DESIGN_REVIEW_SUBMITTED,
            title: "Design Submitted for Review",
            message: `${designerDisplayName} submitted review round ${roundNumber}.`,
            researchItemId,
          })),
        });

        return {
          researchItem: {
            id: researchItemId,
            status: ResearchStatus.DESIGN_REVIEW,
          },
          reviewSubmission: {
            id: reviewSubmission.id,
            roundNumber: reviewSubmission.roundNumber,
            imageUrl:
              reviewSubmission.imageDeletedAt === null
                ? reviewSubmission.imageUrl
                : null,
            imageDeletedAt: reviewSubmission.imageDeletedAt,
            note: reviewSubmission.note,
            submittedAt: reviewSubmission.submittedAt,
          },
        };
      },
      {
        maxWait: 10000,
        timeout: 15000,
      }
    );
  } catch (error) {
    // Attempt cleanup of uploaded Cloudinary image on any DB failure
    try {
      await deleteTemporaryReviewImage(uploadedImage.publicId, destroyer);
    } catch {
      // Do not mask original error if cleanup fails
    }
    throw error;
  }
};

// Atomically transitions an item from CORRECTION_NEEDED to DESIGN_IN_PROGRESS and sets startedAt if not yet initialized.
export const startCorrection = async (
  workspaceId: string,
  researchItemId: string,
  designerId: string
): Promise<StartCorrectionResult> => {
  return await prisma.$transaction(
    async (tx) => {
      // 1. Scoped lookup: verify research item exists in the requested workspace
      const researchItem = await tx.researchItem.findFirst({
        where: {
          id: researchItemId,
          workspaceId,
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (!researchItem) {
        throw new ApiError(404, "Research item not found");
      }

      // 2. Fetch current active design assignment
      const currentAssignment = await tx.designAssignment.findFirst({
        where: {
          researchItemId,
          isCurrent: true,
        },
        select: {
          id: true,
          designerId: true,
          startedAt: true,
        },
      });

      if (!currentAssignment || currentAssignment.designerId !== designerId) {
        throw new ApiError(403, "You are not assigned to this research item");
      }

      // 3. Status validation: source status must strictly be CORRECTION_NEEDED
      if (researchItem.status !== ResearchStatus.CORRECTION_NEEDED) {
        throw new ApiError(
          409,
          `Cannot start correction for an item with status ${researchItem.status}`
        );
      }

      const now = new Date();

      // 4. Concurrency gate: conditional atomic status transition on ResearchItem
      const updatedItemResult = await tx.researchItem.updateMany({
        where: {
          id: researchItemId,
          workspaceId,
          status: ResearchStatus.CORRECTION_NEEDED,
        },
        data: {
          status: ResearchStatus.DESIGN_IN_PROGRESS,
          updatedAt: now,
        },
      });

      if (updatedItemResult.count !== 1) {
        throw new ApiError(
          409,
          "Research item is not in CORRECTION_NEEDED status or has already been updated"
        );
      }

      // 5. Conditional startedAt initialization:
      // Case A: Continuing designer already has startedAt -> preserved as-is.
      // Case B: Newly reassigned designer has startedAt === null -> initialize to now.
      if (currentAssignment.startedAt === null) {
        const updatedAssignmentResult = await tx.designAssignment.updateMany({
          where: {
            id: currentAssignment.id,
            researchItemId,
            designerId,
            isCurrent: true,
            startedAt: null,
          },
          data: {
            startedAt: now,
          },
        });

        if (updatedAssignmentResult.count !== 1) {
          throw new ApiError(
            409,
            "Design assignment has already been modified or reassigned"
          );
        }
      }

      // 6. Post-gate race verification: verify assignment is still current and owned by authenticated designer
      const recheckAssignment = await tx.designAssignment.findFirst({
        where: {
          id: currentAssignment.id,
          researchItemId,
          isCurrent: true,
        },
        select: {
          designerId: true,
        },
      });

      if (
        !recheckAssignment ||
        recheckAssignment.designerId !== designerId
      ) {
        throw new ApiError(
          403,
          "Design assignment changed concurrently during start correction"
        );
      }

      return {
        researchItem: {
          id: researchItem.id,
          status: ResearchStatus.DESIGN_IN_PROGRESS,
        },
      };
    },
    {
      maxWait: 10000,
      timeout: 15000,
    }
  );
};

// Uploads validated final assets to private R2 storage before persisting their internal object keys.
export const uploadFinalAssets = async (
  workspaceId: string,
  researchItemId: string,
  designerId: string,
  incomingFiles: FinalAssetIncomingFile[],
  storage: FinalAssetStorageOperations = r2FinalAssetStorage
): Promise<UploadFinalAssetsResult> => {
  // 1. Validate file inputs
  if (!incomingFiles || incomingFiles.length === 0) {
    throw new ApiError(400, "At least one final asset file is required");
  }

  if (incomingFiles.length > MAX_FINAL_ASSET_FILES) {
    throw new ApiError(
      400,
      `Cannot upload more than ${MAX_FINAL_ASSET_FILES} files at once`
    );
  }

  for (const file of incomingFiles) {
    validateFinalAssetFile(file);
  }

  // 2. Authoritative prechecks
  const researchItem = await prisma.researchItem.findFirst({
    where: {
      id: researchItemId,
      workspaceId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!researchItem) {
    throw new ApiError(404, "Research item not found");
  }

  if (researchItem.status !== ResearchStatus.DESIGN_APPROVED) {
    throw new ApiError(
      409,
      `Cannot upload final assets for research item with status ${researchItem.status}`
    );
  }

  const currentAssignment = await prisma.designAssignment.findFirst({
    where: {
      researchItemId,
      isCurrent: true,
    },
    select: {
      id: true,
      designerId: true,
      isCurrent: true,
    },
  });

  if (!currentAssignment) {
    throw new ApiError(409, "No active assignment found for this research item");
  }

  if (currentAssignment.designerId !== designerId) {
    throw new ApiError(403, "You are not assigned to this research item");
  }

  // Verify approval invariant: latest review submission exists and was approved
  const latestReview = await prisma.reviewSubmission.findFirst({
    where: { researchItemId },
    orderBy: { roundNumber: "desc" },
    select: {
      id: true,
      approvedAt: true,
    },
  });

  if (!latestReview || !latestReview.approvedAt) {
    throw new ApiError(
      500,
      "Approved review submission record not found for this design"
    );
  }

  // One-batch rule: reject duplicate upload if FinalAssets already exist
  const existingFinalAssetsCount = await prisma.finalAsset.count({
    where: { researchItemId },
  });

  if (existingFinalAssetsCount > 0) {
    throw new ApiError(
      409,
      "Final assets have already been uploaded for this design."
    );
  }

  const uploadedAssets: UploadedFinalAsset[] = [];

  try {
    for (const file of incomingFiles) {
      const validatedFile = validateFinalAssetFile(file);
      const fileName = validatedFile.sanitizedName;
      const storageKey = buildFinalAssetKey({
        workspaceId,
        researchItemId,
        fileName,
      });

      await storage.upload({
        storageKey,
        body: fs.createReadStream(file.path),
        mimeType: validatedFile.mimeType,
        contentLength: file.size,
      });

      uploadedAssets.push({
        storageKey,
        fileName,
        fileSize: BigInt(file.size),
        mimeType: validatedFile.mimeType,
      });
    }
  } catch {
    await rollbackUploadedFinalAssets(uploadedAssets, storage.remove);
    throw new ApiError(502, "Failed to upload final asset to storage.");
  }

  try {
    const finalAssets = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT id FROM "ResearchItem" WHERE id = ${researchItemId} FOR UPDATE`;

        const currentResearchItem = await tx.researchItem.findFirst({
          where: {
            id: researchItemId,
            workspaceId,
          },
          select: {
            id: true,
            status: true,
          },
        });

        if (!currentResearchItem) {
          throw new ApiError(404, "Research item not found");
        }

        if (currentResearchItem.status !== ResearchStatus.DESIGN_APPROVED) {
          throw new ApiError(
            409,
            `Cannot upload final assets for research item with status ${currentResearchItem.status}`
          );
        }

        const currentDesignAssignment = await tx.designAssignment.findFirst({
          where: {
            researchItemId,
            isCurrent: true,
          },
          select: {
            designerId: true,
          },
        });

        if (!currentDesignAssignment) {
          throw new ApiError(409, "No active assignment found for this research item");
        }

        if (currentDesignAssignment.designerId !== designerId) {
          throw new ApiError(403, "You are not assigned to this research item");
        }

        const currentLatestReview = await tx.reviewSubmission.findFirst({
          where: { researchItemId },
          orderBy: { roundNumber: "desc" },
          select: {
            approvedAt: true,
          },
        });

        if (!currentLatestReview || !currentLatestReview.approvedAt) {
          throw new ApiError(
            500,
            "Approved review submission record not found for this design"
          );
        }

        const currentFinalAssetCount = await tx.finalAsset.count({
          where: { researchItemId },
        });

        if (currentFinalAssetCount > 0) {
          throw new ApiError(
            409,
            "Final assets have already been uploaded for this design."
          );
        }

        return Promise.all(
          uploadedAssets.map((asset) =>
            tx.finalAsset.create({
              data: {
                researchItemId,
                storageKey: asset.storageKey,
                fileName: asset.fileName,
                fileSize: asset.fileSize,
                mimeType: asset.mimeType,
                uploadedById: designerId,
              },
              select: {
                id: true,
                fileName: true,
                fileSize: true,
                mimeType: true,
              },
            })
          )
        );
      },
      {
        maxWait: 10000,
        timeout: 15000,
      }
    );

    return {
      researchItem: {
        id: researchItem.id,
        status: researchItem.status,
      },
      finalAssets: finalAssets.map((asset) => ({
        id: asset.id,
        fileName: asset.fileName,
        fileSize: asset.fileSize.toString(),
        mimeType: asset.mimeType,
      })),
    };
  } catch (error) {
    await rollbackUploadedFinalAssets(uploadedAssets, storage.remove);

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(500, "Failed to save final assets");
  }
};

// Atomically completes the designer workflow after final assets are uploaded, transitioning status to READY_FOR_LISTING.
export const completeDesignWork = async (
  workspaceId: string,
  researchItemId: string,
  designerId: string
): Promise<CompleteDesignResult> => {
  return await prisma.$transaction(
    async (tx) => {
      // 1. Authoritative transaction-level row lock on ResearchItem
      await tx.$executeRaw`SELECT id FROM "ResearchItem" WHERE id = ${researchItemId} FOR UPDATE`;

      // 2. Scoped lookup: verify research item exists in this workspace
      const researchItem = await tx.researchItem.findFirst({
        where: {
          id: researchItemId,
          workspaceId,
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (!researchItem) {
        throw new ApiError(404, "Research item not found");
      }

      // 3. Status validation: allowed ONLY from DESIGN_APPROVED
      if (researchItem.status !== ResearchStatus.DESIGN_APPROVED) {
        throw new ApiError(
          409,
          `Cannot complete design for research item with status ${researchItem.status}`
        );
      }

      // 4. Current assignment verification: only current assigned designer may complete
      const currentAssignment = await tx.designAssignment.findFirst({
        where: {
          researchItemId,
          isCurrent: true,
        },
        select: {
          id: true,
          designerId: true,
          startedAt: true,
          completedAt: true,
        },
      });

      if (!currentAssignment) {
        throw new ApiError(409, "No active assignment found for this research item");
      }

      if (currentAssignment.designerId !== designerId) {
        throw new ApiError(403, "You are not assigned to this research item");
      }

      // 5. Final asset prerequisite: at least one FinalAsset must exist
      const finalAssetCount = await tx.finalAsset.count({
        where: { researchItemId },
      });

      if (finalAssetCount === 0) {
        throw new ApiError(
          409,
          "Final assets must be uploaded before completing the design."
        );
      }

      // 6. Approval invariant: latest review exists and was approved
      const latestReview = await tx.reviewSubmission.findFirst({
        where: { researchItemId },
        orderBy: { roundNumber: "desc" },
        select: {
          id: true,
          approvedAt: true,
        },
      });

      if (!latestReview || !latestReview.approvedAt) {
        throw new ApiError(
          500,
          "Approved review submission record not found for this design"
        );
      }

      const now = new Date();

      // 7. Atomic status transition to READY_FOR_LISTING
      const updatedItemResult = await tx.researchItem.updateMany({
        where: {
          id: researchItemId,
          workspaceId,
          status: ResearchStatus.DESIGN_APPROVED,
        },
        data: {
          status: ResearchStatus.READY_FOR_LISTING,
          updatedAt: now,
        },
      });

      if (updatedItemResult.count !== 1) {
        throw new ApiError(
          409,
          "Design has already been completed or status has changed"
        );
      }

      // 8. Atomically set completedAt on current DesignAssignment if currently null
      let completedAt = currentAssignment.completedAt;
      if (completedAt === null) {
        const updateAssignmentResult = await tx.designAssignment.updateMany({
          where: {
            id: currentAssignment.id,
            researchItemId,
            designerId,
            isCurrent: true,
            completedAt: null,
          },
          data: {
            completedAt: now,
          },
        });

        if (updateAssignmentResult.count === 1) {
          completedAt = now;
        }
      }

      // 9. Auto-assign least-workload lister if eligible lister exists in workspace
      await acquireWorkspaceMemberMutationLock(tx, workspaceId);
      const workspace = await tx.workspace.findUnique({
        where: { id: workspaceId },
        select: { listerAutoAssignmentEnabled: true },
      });

      if (workspace?.listerAutoAssignmentEnabled) {
        await assignLeastWorkloadLister(tx, workspaceId, researchItemId);
      }

      return {
        researchItem: {
          id: researchItemId,
          status: ResearchStatus.READY_FOR_LISTING,
        },
        finalAssetCount,
        completedAt: completedAt ?? now,
      };
    },
    {
      maxWait: 10000,
      timeout: 15000,
    }
  );
};

export const getAdminDesignList = async (
  workspaceId: string,
  query: GetAdminDesignListQueryInput
): Promise<AdminDesignListResult> => {
  const { page, limit, designerId, status, date, search } = query;

  const where: Prisma.ResearchItemWhereInput = {
    workspaceId,
    status: status ? status : { in: [...ADMIN_DESIGN_WORKFLOW_STATUSES] },
  };

  if (designerId) {
    where.designAssignments = {
      some: { designerId },
    };
  }

  if (date) {
    const [year, month, day] = date.split("-").map(Number);
    const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
    where.createdAt = {
      gte: startOfDay,
      lt: nextDay,
    };
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { etsyListingId: { contains: search, mode: "insensitive" } },
      { normalizedUrl: { contains: search, mode: "insensitive" } },
      { originalUrl: { contains: search, mode: "insensitive" } },
    ];
  }

  const skip = (page - 1) * limit;

  const [rawItems, total] = await prisma.$transaction([
    prisma.researchItem.findMany({
      where,
      select: {
        id: true,
        etsyListingId: true,
        originalUrl: true,
        normalizedUrl: true,
        title: true,
        referenceImageUrl: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        designAssignments: {
          where: { isCurrent: true },
          take: 1,
          select: {
            id: true,
            assignedAt: true,
            startedAt: true,
            completedAt: true,
            designer: {
              select: {
                id: true,
                name: true,
                email: true,
                profileImageUrl: true,
              },
            },
          },
        },
        reviewSubmissions: {
          orderBy: [{ roundNumber: "desc" }],
          take: 1,
          select: {
            id: true,
            roundNumber: true,
            submittedAt: true,
            approvedAt: true,
          },
        },
        issueReports: {
          orderBy: [{ createdAt: "desc" }],
          take: 1,
          select: {
            id: true,
            reason: true,
            details: true,
            createdAt: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
    }),
    prisma.researchItem.count({ where }),
  ]);

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  const items: AdminDesignListItem[] = rawItems.map((item) => {
    const currentAssignment = item.designAssignments[0] ?? null;
    const latestReview = item.reviewSubmissions[0] ?? null;
    const latestIssue = item.issueReports[0] ?? null;

    return {
      id: item.id,
      etsyListingId: item.etsyListingId,
      originalUrl: item.originalUrl,
      normalizedUrl: item.normalizedUrl,
      title: item.title,
      referenceImageUrl: item.referenceImageUrl,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      currentDesigner: currentAssignment?.designer ?? null,
      currentAssignment: currentAssignment
        ? {
            id: currentAssignment.id,
            assignedAt: currentAssignment.assignedAt,
            startedAt: currentAssignment.startedAt,
            completedAt: currentAssignment.completedAt,
          }
        : null,
      latestReview: latestReview
        ? {
            id: latestReview.id,
            roundNumber: latestReview.roundNumber,
            submittedAt: latestReview.submittedAt,
            approvedAt: latestReview.approvedAt,
          }
        : null,
      latestIssueReport: latestIssue
        ? {
            id: latestIssue.id,
            reason: latestIssue.reason,
            details: latestIssue.details,
            createdAt: latestIssue.createdAt,
          }
        : null,
    };
  });

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
};
