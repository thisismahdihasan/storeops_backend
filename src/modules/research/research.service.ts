import { Prisma, ResearchStatus, WorkspaceRole } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import { ApiError } from "../../shared/ApiError.js";
import { extractEtsyListing } from "./research.helper.js";
import { fetchEtsyMetadata } from "./research.metadata.js";
import {
  ACTIVE_DESIGN_STATUSES,
  findLeastWorkloadDesigner,
} from "./research.assignment.js";
import {
  CreateResearchItemInput,
  BulkAssignResearchBodyInput,
  GetResearchItemsQueryInput,
  PreviewResearchItemInput,
  UpdateResearchItemBodyInput,
} from "./research.validation.js";
import {
  DuplicateResearchItemData,
  EtsyMetadata,
  ReassignedResearchItemData,
  ResearchItemListResult,
  ResearchReviewActivity,
  SafeResearchItem,
  ResearchItemDetailResult,
  ResearchPreviewResult,
  ManualReferenceImageUploadResult,
  DeleteResearchItemResult,
} from "./research.type.js";
import {
  destroyReferenceImageFromCloudinary,
  uploadReferenceImageToCloudinary,
  ReferenceImageUploader,
  ReferenceImageDestroyer,
} from "./research.storage.js";
import { deleteObject } from "../storage/r2.js";
import { NOTIFICATION_TYPE_DESIGN_ASSIGNED } from "../notification/notification.type.js";
import { acquireWorkspaceMemberMutationLock } from "../workspace/workspace.member-lock.js";
import { getRoleAssignmentEligibilityFilter } from "../workspace/workspace.assignment-eligibility.js";

export const safeResearchItemSelect = {
  id: true,
  workspaceId: true,
  etsyListingId: true,
  originalUrl: true,
  normalizedUrl: true,
  title: true,
  referenceImageUrl: true,
  status: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

const duplicateResearchItemSelect = {
  id: true,
  status: true,
  createdAt: true,
  createdBy: {
    select: {
      id: true,
      name: true,
      email: true,
      profileImageUrl: true,
    },
  },
} as const;

export type CreateResearchItemOptions = {
  metadataFetcher?: (url: string) => Promise<EtsyMetadata>;
  manualImageFile?: { buffer: Buffer; mimetype: string };
  uploader?: ReferenceImageUploader;
  destroyer?: ReferenceImageDestroyer;
};

// Creates a new research item, parses metadata or handles manual upload, and atomically auto-assigns the least-loaded designer.
// Invariant: A research item must NEVER be created without a valid reference image.
export const createResearchItem = async (
  workspaceId: string,
  userId: string,
  input: CreateResearchItemInput,
  actorRoles: readonly WorkspaceRole[],
  options?: CreateResearchItemOptions
): Promise<SafeResearchItem> => {
  const isAdmin = actorRoles.includes(WorkspaceRole.ADMIN);
  const { originalUrl, normalizedUrl, etsyListingId } = extractEtsyListing(
    input.etsyUrl
  );

  // 1. Readable duplicate pre-check within the same workspace BEFORE any upload
  const existingItem = await prisma.researchItem.findUnique({
    where: {
      workspaceId_etsyListingId: {
        workspaceId,
        etsyListingId,
      },
    },
    select: duplicateResearchItemSelect,
  });

  if (existingItem) {
    const duplicateData: DuplicateResearchItemData = isAdmin
      ? {
          alreadyExists: true,
          researchItemId: existingItem.id,
          createdBy: existingItem.createdBy,
          currentStatus: existingItem.status,
          createdAt: existingItem.createdAt,
        }
      : { alreadyExists: true };

    throw new ApiError(
      409,
      "This Etsy listing has already been added to this workspace",
      true,
      "",
      duplicateData
    );
  }

  // 2. Resolve reference image (manual upload or automatic Etsy extraction)
  let referenceImageUrl: string | null = null;
  let referenceImagePublicId: string | null = null;
  let itemTitle: string | null = null;

  if (options?.manualImageFile) {
    // 2a. Manual image file provided: upload to Cloudinary first
    const uploader = options.uploader ?? uploadReferenceImageToCloudinary;
    const uploadResult = await uploader({
      buffer: options.manualImageFile.buffer,
      mimetype: options.manualImageFile.mimetype,
    });
    referenceImageUrl = uploadResult.secureUrl;
    referenceImagePublicId = uploadResult.publicId;

    // Best-effort metadata fetch for title
    try {
      const metadataFetcher = options.metadataFetcher ?? fetchEtsyMetadata;
      const metadata = await metadataFetcher(normalizedUrl);
      itemTitle = metadata.title;
    } catch {
      itemTitle = null;
    }
  } else {
    // 2b. No manual image: attempt Etsy metadata extraction
    try {
      const metadataFetcher = options?.metadataFetcher ?? fetchEtsyMetadata;
      const metadata = await metadataFetcher(normalizedUrl);
      itemTitle = metadata.title;
      referenceImageUrl = metadata.referenceImageUrl;
    } catch {
      itemTitle = null;
      referenceImageUrl = null;
    }
  }

  // 3. Invariant check: A research item must NEVER be created without a reference image
  if (!referenceImageUrl) {
    throw new ApiError(
      422,
      "A reference image is required to create this research item.",
      true,
      "",
      { code: "REFERENCE_IMAGE_REQUIRED" }
    );
  }

  // 4. Atomically create ResearchItem and auto-assign eligible designer if available
  try {
    const createdItem = await prisma.$transaction(async (tx) => {
      await acquireWorkspaceMemberMutationLock(tx, workspaceId);

      // Check workspace-level auto assignment toggle
      const workspace = await tx.workspace.findUnique({
        where: { id: workspaceId },
        select: { designerAutoAssignmentEnabled: true },
      });

      let chosenDesignerId: string | null = null;
      if (workspace?.designerAutoAssignmentEnabled) {
        chosenDesignerId = await findLeastWorkloadDesigner(tx, workspaceId);
      }

      const initialStatus = chosenDesignerId
        ? ResearchStatus.ASSIGNED
        : ResearchStatus.RESEARCHED;

      const item = await tx.researchItem.create({
        data: {
          workspaceId,
          etsyListingId,
          originalUrl,
          normalizedUrl,
          title: itemTitle,
          referenceImageUrl,
          referenceImagePublicId,
          createdById: userId,
          status: initialStatus,
        },
        select: safeResearchItemSelect,
      });

      if (chosenDesignerId) {
        await tx.designAssignment.create({
          data: {
            researchItemId: item.id,
            designerId: chosenDesignerId,
            isCurrent: true,
          },
          select: { id: true },
        });
        await tx.notification.create({
          data: {
            workspaceId,
            userId: chosenDesignerId,
            type: NOTIFICATION_TYPE_DESIGN_ASSIGNED,
            title: "Design Assigned",
            message: "You have been assigned a new design.",
            researchItemId: item.id,
          },
        });
      }

      return item;
    },
    {
      maxWait: 10000,
      timeout: 15000,
    });

    return createdItem;
  } catch (error) {
    // Roll back Cloudinary asset if manual image was uploaded but DB transaction failed
    if (referenceImagePublicId) {
      try {
        const destroyer =
          options?.destroyer ?? destroyReferenceImageFromCloudinary;
        await destroyer(referenceImagePublicId);
      } catch {
        // Rollback error silently handled, preserving original error
      }
    }

    // Catch concurrent duplicate creation race condition (P2002)
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const concurrentItem = await prisma.researchItem.findUnique({
        where: {
          workspaceId_etsyListingId: {
            workspaceId,
            etsyListingId,
          },
        },
        select: duplicateResearchItemSelect,
      });

      const duplicateData: DuplicateResearchItemData =
        isAdmin && concurrentItem
          ? {
              alreadyExists: true,
              researchItemId: concurrentItem.id,
              createdBy: concurrentItem.createdBy,
              currentStatus: concurrentItem.status,
              createdAt: concurrentItem.createdAt,
            }
          : { alreadyExists: true };

      throw new ApiError(
        409,
        "This Etsy listing has already been added to this workspace",
        true,
        "",
        duplicateData
      );
    }

    throw error;
  }
};


export const safeResearchItemListSelect = Prisma.validator<Prisma.ResearchItemSelect>()({
  id: true,
  workspaceId: true,
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
      profileImageUrl: true,
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
      completedAt: true,
      isCurrent: true,
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
  issueReports: {
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      id: true,
      reason: true,
      details: true,
      createdAt: true,
      reportedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          profileImageUrl: true,
        },
      },
    },
  },
});

const safeResearchItemDetailSelect = {
  id: true,
  workspaceId: true,
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
      profileImageUrl: true,
    },
  },
  designAssignments: {
    where: { isCurrent: true },
    take: 1,
    select: {
      id: true,
      designerId: true,
      assignedAt: true,
      startedAt: true,
      completedAt: true,
      isCurrent: true,
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
    orderBy: { roundNumber: "desc" },
    take: 1,
    select: {
      id: true,
      roundNumber: true,
      imageUrl: true,
      imageDeletedAt: true,
      note: true,
      submittedAt: true,
      approvedAt: true,
      approvedById: true,
    },
  },
} as const;

const assertCurrentListingAssignmentOwnership = async (
  researchItemId: string,
  userId: string
): Promise<void> => {
  const assignment = await prisma.listingAssignment.findFirst({
    where: {
      researchItemId,
      listerId: userId,
      isCurrent: true,
    },
    select: { id: true },
  });

  if (!assignment) {
    throw new ApiError(403, "You are not assigned to this research item");
  }
};

// Returns a paginated list of workspace research items matching creator, status, date, or search filters.
export const getResearchItems = async (
  workspaceId: string,
  query: GetResearchItemsQueryInput,
  userId: string,
  roles: readonly WorkspaceRole[]
): Promise<ResearchItemListResult> => {
  const { page, limit, createdBy, status, date, search, assignment } = query;
  const isAdmin = roles.includes(WorkspaceRole.ADMIN);

  const where: Prisma.ResearchItemWhereInput = {
    workspaceId,
    ...(isAdmin ? {} : { createdById: userId }),
  };

  if (isAdmin && createdBy) {
    where.createdById = createdBy;
  }

  if (status) {
    where.status = status;
  }

  if (assignment === "UNASSIGNED") {
    where.status = ResearchStatus.RESEARCHED;
    where.designAssignments = { none: { isCurrent: true } };
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
      select: safeResearchItemListSelect,
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      skip,
      take: limit,
    }),
    prisma.researchItem.count({ where }),
  ]);

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  const itemIds = rawItems.map((item) => item.id);
  const reviewActivityMap = await getResearchReviewActivityMap(itemIds);

  const items = rawItems.map((item) => {
    const currentAssignment = item.designAssignments[0] ?? null;
    const latestIssueReport = item.issueReports[0] ?? null;
    const activity = reviewActivityMap[item.id] ?? {
      designerReplyCount: 0,
      latestDesignerReplyAt: null,
      latestReviewId: null,
    };

    return {
      id: item.id,
      workspaceId: item.workspaceId,
      etsyListingId: item.etsyListingId,
      originalUrl: item.originalUrl,
      normalizedUrl: item.normalizedUrl,
      title: item.title,
      referenceImageUrl: item.referenceImageUrl,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      createdBy: item.createdBy,
      currentDesigner: currentAssignment?.designer ?? null,
      currentDesignAssignment: currentAssignment
        ? {
            id: currentAssignment.id,
            designerId: currentAssignment.designerId,
            assignedAt: currentAssignment.assignedAt,
            startedAt: currentAssignment.startedAt,
            completedAt: currentAssignment.completedAt,
            isCurrent: currentAssignment.isCurrent,
          }
        : null,
      latestIssueReport,
      reviewActivity: {
        designerReplyCount: activity.designerReplyCount,
        latestDesignerReplyAt: activity.latestDesignerReplyAt
          ? activity.latestDesignerReplyAt.toISOString()
          : null,
        latestReviewId: activity.latestReviewId,
      },
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

// Atomically assigns selected, currently unassigned RESEARCHED items to an explicit
// Designer or distributes them among eligible Designers with deterministic balancing.
export const bulkAssignResearchDesigners = async (
  workspaceId: string,
  input: BulkAssignResearchBodyInput
) => {
  return await prisma.$transaction(
    async (tx) => {
      const workspaceItemCount = await tx.researchItem.count({
        where: {
          workspaceId,
          id: { in: input.researchItemIds },
        },
      });

      if (workspaceItemCount !== input.researchItemIds.length) {
        throw new ApiError(404, "One or more research items were not found");
      }

      const lockedResearchItemIds = [...input.researchItemIds].sort((a, b) =>
        a.localeCompare(b)
      );

      // Lock and validate every requested item in a deterministic order before
      // acquiring the workspace member lock, matching the canonical row-first order.
      for (const researchItemId of lockedResearchItemIds) {
        const locked = await tx.researchItem.updateMany({
          where: {
            id: researchItemId,
            workspaceId,
            status: ResearchStatus.RESEARCHED,
            designAssignments: { none: { isCurrent: true } },
          },
          data: { updatedAt: new Date() },
        });

        if (locked.count !== 1) {
          throw new ApiError(
            409,
            "All research items must be unassigned and in RESEARCHED status"
          );
        }
      }

      await acquireWorkspaceMemberMutationLock(tx, workspaceId);

      let designerIds: string[];

      if (input.mode === "TARGET") {
        const targetMember = await tx.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId,
              userId: input.designerId,
            },
          },
          select: { roles: true },
        });

        if (!targetMember?.roles.includes(WorkspaceRole.DESIGNER)) {
          throw new ApiError(
            400,
            "Selected user is not a designer in this workspace"
          );
        }

        designerIds = input.researchItemIds.map(() => input.designerId);
      } else {
        const eligibleMembers = await tx.workspaceMember.findMany({
          where: {
            workspaceId,
            ...getRoleAssignmentEligibilityFilter(WorkspaceRole.DESIGNER),
          },
          select: {
            userId: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
        });

        if (eligibleMembers.length === 0) {
          throw new ApiError(409, "No eligible designers are available");
        }

        const workloadRows = await tx.designAssignment.groupBy({
          by: ["designerId"],
          where: {
            designerId: { in: eligibleMembers.map((member) => member.userId) },
            isCurrent: true,
            researchItem: {
              workspaceId,
              status: { in: ACTIVE_DESIGN_STATUSES },
            },
          },
          _count: { _all: true },
        });
        const workloadByDesignerId = new Map(
          workloadRows.map((row) => [row.designerId, row._count._all])
        );
        const candidates = eligibleMembers.map((member) => ({
          ...member,
          activeWorkload: workloadByDesignerId.get(member.userId) ?? 0,
        }));
        const [firstCandidate] = candidates;

        if (!firstCandidate) {
          throw new ApiError(409, "No eligible designers are available");
        }

        designerIds = input.researchItemIds.map(() => {
          let chosenCandidate = firstCandidate;
          for (const candidate of candidates) {
            if (
              candidate.activeWorkload < chosenCandidate.activeWorkload ||
              (candidate.activeWorkload === chosenCandidate.activeWorkload &&
                (candidate.createdAt < chosenCandidate.createdAt ||
                  (candidate.createdAt.getTime() ===
                    chosenCandidate.createdAt.getTime() &&
                    candidate.userId.localeCompare(chosenCandidate.userId) < 0)))
            ) {
              chosenCandidate = candidate;
            }
          }
          chosenCandidate.activeWorkload += 1;
          return chosenCandidate.userId;
        });
      }

      // Revalidate immediately before transitioning state and creating assignments.
      for (const researchItemId of lockedResearchItemIds) {
        const updated = await tx.researchItem.updateMany({
          where: {
            id: researchItemId,
            workspaceId,
            status: ResearchStatus.RESEARCHED,
            designAssignments: { none: { isCurrent: true } },
          },
          data: { status: ResearchStatus.ASSIGNED },
        });

        if (updated.count !== 1) {
          throw new ApiError(
            409,
            "All research items must be unassigned and in RESEARCHED status"
          );
        }
      }

      await tx.designAssignment.createMany({
        data: input.researchItemIds.map((researchItemId, index) => ({
          researchItemId,
          designerId: designerIds[index],
          isCurrent: true,
        })),
      });
      await tx.notification.createMany({
        data: input.researchItemIds.map((researchItemId, index) => ({
          workspaceId,
          userId: designerIds[index],
          type: NOTIFICATION_TYPE_DESIGN_ASSIGNED,
          title: "Design Assigned",
          message: "You have been assigned a new design.",
          researchItemId,
        })),
      });

      return {
        assignedCount: input.researchItemIds.length,
        assignedItemIds: input.researchItemIds,
      };
    },
    { maxWait: 10000, timeout: 15000 }
  );
};

export type ResearchReviewActivityMap = Record<
  string,
  {
    designerReplyCount: number;
    latestDesignerReplyAt: Date | null;
    latestReviewId: string | null;
  }
>;

type ResearchReviewActivityAggregateRow = {
  researchItemId: string;
  designerReplyCount: bigint;
  latestDesignerReplyAt: Date | null;
  latestReviewId: string | null;
};

const MAX_SAFE_REPLY_COUNT = BigInt(Number.MAX_SAFE_INTEGER);

const toSafeReplyCount = (count: bigint): number => {
  if (count < 0n || count > MAX_SAFE_REPLY_COUNT) {
    throw new Error("Designer reply count exceeds JavaScript safe integer range");
  }

  return Number(count);
};

// Fetches review activity (designer reply count, latest review ID, latest designer reply timestamp)
// in a single batched query for the current research item IDs, preventing N+1 queries.
export const getResearchReviewActivityMap = async (
  itemIds: string[]
): Promise<ResearchReviewActivityMap> => {
  const map: ResearchReviewActivityMap = {};
  if (itemIds.length === 0) {
    return map;
  }

  for (const itemId of itemIds) {
    map[itemId] = {
      designerReplyCount: 0,
      latestDesignerReplyAt: null,
      latestReviewId: null,
    };
  }

  const rows = await prisma.$queryRaw<ResearchReviewActivityAggregateRow[]>(
    Prisma.sql`
      WITH input_items AS (
        SELECT DISTINCT UNNEST(ARRAY[${Prisma.join(itemIds)}]::text[]) AS "researchItemId"
      ),
      latest_reviews AS (
        SELECT DISTINCT ON (review."researchItemId")
          review."researchItemId",
          review."id" AS "latestReviewId"
        FROM "ReviewSubmission" AS review
        WHERE review."researchItemId" IN (
          SELECT "researchItemId" FROM input_items
        )
        ORDER BY
          review."researchItemId",
          review."roundNumber" DESC,
          review."id" DESC
      ),
      designer_reply_activity AS (
        SELECT
          review."researchItemId",
          COUNT(reply."id") AS "designerReplyCount",
          MAX(reply."createdAt") AS "latestDesignerReplyAt"
        FROM "ReviewSubmission" AS review
        INNER JOIN "ReviewAnnotation" AS annotation
          ON annotation."reviewSubmissionId" = review."id"
        INNER JOIN "AnnotationReply" AS reply
          ON reply."annotationId" = annotation."id"
          AND reply."createdById" = review."designerId"
        WHERE review."researchItemId" IN (
          SELECT "researchItemId" FROM input_items
        )
        GROUP BY review."researchItemId"
      )
      SELECT
        input_items."researchItemId",
        COALESCE(designer_reply_activity."designerReplyCount", 0) AS "designerReplyCount",
        designer_reply_activity."latestDesignerReplyAt",
        latest_reviews."latestReviewId"
      FROM input_items
      LEFT JOIN latest_reviews
        ON latest_reviews."researchItemId" = input_items."researchItemId"
      LEFT JOIN designer_reply_activity
        ON designer_reply_activity."researchItemId" = input_items."researchItemId"
    `
  );

  for (const row of rows) {
    map[row.researchItemId] = {
      designerReplyCount: toSafeReplyCount(row.designerReplyCount),
      latestDesignerReplyAt: row.latestDesignerReplyAt,
      latestReviewId: row.latestReviewId,
    };
  }

  return map;
};

// Fetches details for a single research item owned by the Researcher unless the caller is an Admin.
export const getResearchItemById = async (
  workspaceId: string,
  researchItemId: string,
  userId: string,
  roles: readonly WorkspaceRole[]
): Promise<ResearchItemDetailResult> => {
  const researchItem = await prisma.researchItem.findFirst({
    where: {
      id: researchItemId,
      workspaceId,
      ...(roles.includes(WorkspaceRole.ADMIN) ? {} : { createdById: userId }),
    },
    select: safeResearchItemDetailSelect,
  });

  if (!researchItem) {
    throw new ApiError(404, "Research item not found");
  }

  const currentAssignment = researchItem.designAssignments[0] ?? null;
  const rawLatestReview = researchItem.reviewSubmissions[0] ?? null;
  const latestReview = rawLatestReview
    ? {
        ...rawLatestReview,
        imageUrl:
          rawLatestReview.imageDeletedAt === null
            ? rawLatestReview.imageUrl
            : null,
      }
    : null;

  return {
    id: researchItem.id,
    workspaceId: researchItem.workspaceId,
    etsyListingId: researchItem.etsyListingId,
    originalUrl: researchItem.originalUrl,
    normalizedUrl: researchItem.normalizedUrl,
    title: researchItem.title,
    referenceImageUrl: researchItem.referenceImageUrl,
    status: researchItem.status,
    createdAt: researchItem.createdAt,
    updatedAt: researchItem.updatedAt,
    createdBy: researchItem.createdBy,
    currentDesigner: currentAssignment?.designer ?? null,
    currentDesignAssignment: currentAssignment
      ? {
          id: currentAssignment.id,
          designerId: currentAssignment.designerId,
          assignedAt: currentAssignment.assignedAt,
          startedAt: currentAssignment.startedAt,
          completedAt: currentAssignment.completedAt,
          isCurrent: currentAssignment.isCurrent,
        }
      : null,
    latestReview,
  };
};

// Retrieves the stored reference image URL for an item after verifying workspace access.
export const getReferenceImageData = async (
  workspaceId: string,
  researchItemId: string
): Promise<{ id: string; referenceImageUrl: string }> => {
  const item = await prisma.researchItem.findFirst({
    where: {
      id: researchItemId,
      workspaceId,
    },
    select: {
      id: true,
      referenceImageUrl: true,
    },
  });

  if (!item) {
    throw new ApiError(404, "Research item not found");
  }

  if (!item.referenceImageUrl || item.referenceImageUrl.trim() === "") {
    throw new ApiError(404, "Reference image not available");
  }

  return {
    id: item.id,
    referenceImageUrl: item.referenceImageUrl.trim(),
  };
};

// Resolves protected reference media for Admins, Researcher owners, and assigned Designer/Lister workflows.
export const getAuthorizedReferenceImageData = async (
  workspaceId: string,
  researchItemId: string,
  userId: string,
  roles: readonly WorkspaceRole[]
): Promise<{ id: string; referenceImageUrl: string }> => {
  const item = await prisma.researchItem.findFirst({
    where: {
      id: researchItemId,
      workspaceId,
    },
    select: {
      id: true,
      createdById: true,
      referenceImageUrl: true,
      designAssignments: {
        where: { isCurrent: true },
        orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          designerId: true,
        },
      },
    },
  });

  if (!item) {
    throw new ApiError(404, "Research item not found");
  }

  const hasAdminAccess = roles.includes(WorkspaceRole.ADMIN);
  const hasResearcherOwnership =
    roles.includes(WorkspaceRole.RESEARCHER) && item.createdById === userId;
  const hasCurrentDesignerAccess =
    roles.includes(WorkspaceRole.DESIGNER) &&
    item.designAssignments[0]?.designerId === userId;

  if (!hasAdminAccess && !hasResearcherOwnership && !hasCurrentDesignerAccess) {
    if (roles.includes(WorkspaceRole.LISTER)) {
      await assertCurrentListingAssignmentOwnership(researchItemId, userId);
    } else {
      throw new ApiError(403, "You are not assigned to this research item");
    }
  }

  if (!item.referenceImageUrl || item.referenceImageUrl.trim() === "") {
    throw new ApiError(404, "Reference image not available");
  }

  return {
    id: item.id,
    referenceImageUrl: item.referenceImageUrl.trim(),
  };
};

export const REASSIGNABLE_STATUSES: ResearchStatus[] = [
  ResearchStatus.RESEARCHED,
  ResearchStatus.ASSIGNED,
  ResearchStatus.DESIGN_IN_PROGRESS,
  ResearchStatus.DESIGN_REVIEW,
  ResearchStatus.CORRECTION_NEEDED,
  ResearchStatus.ISSUE_REPORTED,
];

// Atomically reassigns an in-flight research item to another workspace designer, preserving assignment history.
export const reassignResearchDesigner = async (
  workspaceId: string,
  researchItemId: string,
  designerId: string
): Promise<ReassignedResearchItemData> => {
  return await prisma.$transaction(async (tx) => {
    // 1. Serialize/lock row and verify item existence within workspace
    let lockedItem;
    try {
      lockedItem = await tx.researchItem.update({
        where: {
          id: researchItemId,
          workspaceId,
        },
        data: { updatedAt: new Date() },
        select: { id: true, status: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new ApiError(404, "Research item not found");
      }
      throw error;
    }

    // 2. Status eligibility check on fresh/locked state
    if (!REASSIGNABLE_STATUSES.includes(lockedItem.status)) {
      throw new ApiError(409, "Research item can no longer be reassigned");
    }

    await acquireWorkspaceMemberMutationLock(tx, workspaceId);

    // 4. Validate target designer in same workspace
    const targetMember = await tx.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: designerId,
        },
      },
      select: {
        userId: true,
        roles: true,
      },
    });

    if (!targetMember || !targetMember.roles.includes(WorkspaceRole.DESIGNER)) {
      throw new ApiError(
        400,
        "Selected user is not a designer in this workspace"
      );
    }

    // 5. Inspect current assignment
    const currentAssignment = await tx.designAssignment.findFirst({
      where: {
        researchItemId,
        isCurrent: true,
      },
      select: {
        id: true,
        designerId: true,
      },
    });

    // 6. Same designer conflict check
    if (currentAssignment && currentAssignment.designerId === designerId) {
      throw new ApiError(
        409,
        "Research item is already assigned to this designer"
      );
    }

    // 7. Mark existing current assignment historical
    if (currentAssignment) {
      await tx.designAssignment.updateMany({
        where: {
          researchItemId,
          isCurrent: true,
        },
        data: {
          isCurrent: false,
        },
      });
    }

    // 8. Create new current assignment
    const newAssignment = await tx.designAssignment.create({
      data: {
        researchItemId,
        designerId,
        isCurrent: true,
      },
      select: {
        id: true,
        designerId: true,
        assignedAt: true,
        isCurrent: true,
      },
    });
    await tx.notification.create({
      data: {
        workspaceId,
        userId: designerId,
        type: NOTIFICATION_TYPE_DESIGN_ASSIGNED,
        title: "Design Assigned",
        message: "You have been assigned a new design.",
        researchItemId,
      },
    });

    // 9. Status transition logic
    let finalStatus = lockedItem.status;
    if (
      lockedItem.status === ResearchStatus.RESEARCHED ||
      lockedItem.status === ResearchStatus.ISSUE_REPORTED
    ) {
      await tx.researchItem.update({
        where: {
          id: researchItemId,
          workspaceId,
        },
        data: { status: ResearchStatus.ASSIGNED },
      });
      finalStatus = ResearchStatus.ASSIGNED;
    }

    return {
      researchItem: {
        id: lockedItem.id,
        status: finalStatus,
      },
      assignment: newAssignment,
    };
  },
  {
    maxWait: 10000,
    timeout: 15000,
  });
};

// Previews Etsy listing metadata and checks same-workspace duplicates without persistent mutations.
export const previewResearchItem = async (
  workspaceId: string,
  input: PreviewResearchItemInput,
  actorRoles: readonly WorkspaceRole[],
  options?: CreateResearchItemOptions
): Promise<ResearchPreviewResult> => {
  const isAdmin = actorRoles.includes(WorkspaceRole.ADMIN);
  const { normalizedUrl, etsyListingId } = extractEtsyListing(input.etsyUrl);

  const existingItem = await prisma.researchItem.findUnique({
    where: {
      workspaceId_etsyListingId: {
        workspaceId,
        etsyListingId,
      },
    },
    select: duplicateResearchItemSelect,
  });

  let metadata: EtsyMetadata = { title: null, referenceImageUrl: null };
  try {
    const metadataFetcher = options?.metadataFetcher ?? fetchEtsyMetadata;
    metadata = await metadataFetcher(normalizedUrl);
  } catch {
    metadata = { title: null, referenceImageUrl: null };
  }

  if (existingItem) {
    return {
      etsyListingId,
      normalizedUrl,
      title: metadata.title,
      referenceImageUrl: metadata.referenceImageUrl,
      alreadyExists: true,
      duplicate: isAdmin
        ? {
            researchItemId: existingItem.id,
            createdBy: existingItem.createdBy,
            currentStatus: existingItem.status,
            createdAt: existingItem.createdAt,
          }
        : null,
    };
  }

  return {
    etsyListingId,
    normalizedUrl,
    title: metadata.title,
    referenceImageUrl: metadata.referenceImageUrl,
    alreadyExists: false,
    duplicate: null,
  };
};

export type UploadReferenceImageOptions = {
  uploader?: ReferenceImageUploader;
  destroyer?: ReferenceImageDestroyer;
};

// Manually uploads and updates the reference image for a research item in Cloudinary.
export const uploadResearchReferenceImage = async (
  workspaceId: string,
  researchItemId: string,
  actorUserId: string,
  actorRoles: readonly WorkspaceRole[],
  file: { buffer: Buffer; mimetype: string },
  options?: UploadReferenceImageOptions
): Promise<ManualReferenceImageUploadResult> => {
  const existingItem = await prisma.researchItem.findFirst({
    where: {
      id: researchItemId,
      workspaceId,
      ...(actorRoles.includes(WorkspaceRole.ADMIN)
        ? {}
        : { createdById: actorUserId }),
    },
    select: {
      id: true,
      referenceImagePublicId: true,
    },
  });

  if (!existingItem) {
    throw new ApiError(404, "Research item not found");
  }

  const uploader = options?.uploader ?? uploadReferenceImageToCloudinary;
  const uploadResult = await uploader({
    buffer: file.buffer,
    mimetype: file.mimetype,
  });

  try {
    await prisma.researchItem.update({
      where: {
        id: researchItemId,
        workspaceId,
      },
      data: {
        referenceImageUrl: uploadResult.secureUrl,
        referenceImagePublicId: uploadResult.publicId,
      },
    });
  } catch (dbError) {
    const destroyer =
      options?.destroyer ?? destroyReferenceImageFromCloudinary;
    await destroyer(uploadResult.publicId);
    throw dbError;
  }

  if (
    existingItem.referenceImagePublicId &&
    existingItem.referenceImagePublicId !== uploadResult.publicId
  ) {
    const destroyer =
      options?.destroyer ?? destroyReferenceImageFromCloudinary;
    await destroyer(existingItem.referenceImagePublicId);
  }

  return {
    researchItemId: existingItem.id,
    referenceImageUrl: uploadResult.secureUrl,
  };
};

// Updates editable metadata (title) for a research item.
export const updateResearchItem = async (
  workspaceId: string,
  researchItemId: string,
  input: UpdateResearchItemBodyInput
): Promise<SafeResearchItem> => {
  const existingItem = await prisma.researchItem.findUnique({
    where: {
      id: researchItemId,
      workspaceId,
    },
    select: { id: true },
  });

  if (!existingItem) {
    throw new ApiError(404, "Research item not found");
  }

  const updatedItem = await prisma.researchItem.update({
    where: {
      id: researchItemId,
      workspaceId,
    },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
    },
    select: safeResearchItemSelect,
  });

  return updatedItem;
};

export type DeleteResearchItemOptions = {
  destroyer?: ReferenceImageDestroyer;
  r2Deleter?: (storageKey: string) => Promise<void>;
};

// Permanently deletes a research item in any lifecycle status. ADMIN only.
// All internal child records are cascade-deleted by PostgreSQL. External storage
// assets (Cloudinary reference image, Cloudinary review screenshots, R2 final
// assets) are cleaned up best-effort after the DB transaction commits.
export const deleteResearchItem = async (
  workspaceId: string,
  researchItemId: string,
  options?: DeleteResearchItemOptions
): Promise<DeleteResearchItemResult> => {
  // 1. Atomic DB transaction: row lock -> pre-fetch cleanup metadata -> notification cleanup -> cascade delete parent
  const cleanupMetadata = await prisma.$transaction(async (tx) => {
    // Explicit row-level lock on ResearchItem to serialize with any concurrent child creations (review/final-asset)
    await tx.$executeRaw`SELECT id FROM "ResearchItem" WHERE id = ${researchItemId} FOR UPDATE`;

    const item = await tx.researchItem.findUnique({
      where: {
        id: researchItemId,
        workspaceId,
      },
      select: {
        id: true,
        referenceImagePublicId: true,
        reviewSubmissions: {
          where: { imageDeletedAt: null },
          select: { imagePublicId: true },
        },
        finalAssets: {
          select: { storageKey: true },
        },
      },
    });

    if (!item) {
      throw new ApiError(404, "Research item not found");
    }

    // Notifications use onDelete: SetNull — delete explicitly to avoid dead alerts
    await tx.notification.deleteMany({
      where: { researchItemId },
    });

    // CASCADE handles: DesignAssignment, IssueReport, ReviewSubmission,
    // ReviewAnnotation, AnnotationReply, FinalAsset, ListingAssignment, ListingResult
    await tx.researchItem.delete({
      where: {
        id: researchItemId,
        workspaceId,
      },
    });

    // Deduplicate review submission image public IDs
    const reviewImagePublicIds = Array.from(
      new Set(item.reviewSubmissions.map((rs) => rs.imagePublicId))
    );
    const finalAssetStorageKeys = item.finalAssets.map((fa) => fa.storageKey);

    return {
      researchItemId: item.id,
      referenceImagePublicId: item.referenceImagePublicId,
      reviewImagePublicIds,
      finalAssetStorageKeys,
    };
  });

  // 2. Post-commit external storage cleanup (best-effort, fully awaited)
  await cleanupExternalAssets({
    researchItemId: cleanupMetadata.researchItemId,
    referenceImagePublicId: cleanupMetadata.referenceImagePublicId,
    reviewImagePublicIds: cleanupMetadata.reviewImagePublicIds,
    finalAssetStorageKeys: cleanupMetadata.finalAssetStorageKeys,
    destroyer: options?.destroyer,
    r2Deleter: options?.r2Deleter,
  });

  return {
    researchItemId: cleanupMetadata.researchItemId,
  };
};

// --- External storage cleanup helpers (post-commit, best-effort) ---

type ExternalAssetCleanupInput = {
  researchItemId: string;
  referenceImagePublicId: string | null;
  reviewImagePublicIds: string[];
  finalAssetStorageKeys: string[];
  destroyer?: ReferenceImageDestroyer;
  r2Deleter?: (storageKey: string) => Promise<void>;
};

// Awaits best-effort external storage cleanup post-commit.
// Each provider operation is isolated so a single failure does not prevent
// remaining assets from being cleaned, and errors never fail the primary API response.
const cleanupExternalAssets = async (
  input: ExternalAssetCleanupInput
): Promise<void> => {
  const {
    researchItemId,
    referenceImagePublicId,
    reviewImagePublicIds,
    finalAssetStorageKeys,
    destroyer,
    r2Deleter,
  } = input;

  const destroy = destroyer ?? destroyReferenceImageFromCloudinary;
  const removeR2Object = r2Deleter ?? deleteObject;

  const cleanupTasks: Promise<void>[] = [];

  // Cloudinary: reference image
  if (referenceImagePublicId) {
    cleanupTasks.push(
      destroy(referenceImagePublicId).catch((error: unknown) => {
        console.warn(
          "[STORAGE_CLEANUP_WARNING] Failed to delete reference image from Cloudinary",
          {
            researchItemId,
            provider: "cloudinary",
            publicId: referenceImagePublicId,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      })
    );
  }

  // Cloudinary: review submission screenshots
  for (const publicId of reviewImagePublicIds) {
    cleanupTasks.push(
      destroy(publicId).catch((error: unknown) => {
        console.warn(
          "[STORAGE_CLEANUP_WARNING] Failed to delete review screenshot from Cloudinary",
          {
            researchItemId,
            provider: "cloudinary",
            publicId,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      })
    );
  }

  // R2: final asset files
  for (const storageKey of finalAssetStorageKeys) {
    cleanupTasks.push(
      removeR2Object(storageKey).catch((error: unknown) => {
        console.warn(
          "[STORAGE_CLEANUP_WARNING] Failed to delete final asset from R2",
          {
            researchItemId,
            provider: "r2",
            storageKey,
            error: error instanceof Error ? error.message : String(error),
          }
        );
      })
    );
  }

  await Promise.allSettled(cleanupTasks);
};
