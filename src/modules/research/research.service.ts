import { Prisma, ReferenceImageStorageProvider, ResearchStatus, WorkspaceRole } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import { ApiError } from "../../shared/ApiError.js";
import { extractEtsyListing } from "./research.helper.js";
import { fetchEtsyListingFromApi } from "./research.etsy.js";
import {
  ACTIVE_DESIGN_STATUSES,
  findLeastWorkloadDesigner,
} from "./research.assignment.js";
import {
  CreateResearchItemInput,
  BulkAssignResearchBodyInput,
  GetIssueItemsQueryInput,
  GetResearchItemsQueryInput,
  GetReferenceUsageHistoryQueryInput,
  GetResearchSummaryQueryInput,
  PreviewResearchItemInput,
  UpdateResearchItemBodyInput,
} from "./research.validation.js";
import { buildDateRangeFilter } from "../role-activity/roleActivity.helper.js";
import {
  DuplicateResearchItemData,
  ReassignedResearchItemData,
  ResearchItemListResult,
  ResearchReviewActivity,
  SafeResearchItem,
  ResearchItemDetailResult,
  ReferenceUsageHistoryResult,
  ResearchPreviewResult,
  ManualReferenceImageUploadResult,
  DeleteResearchItemResult,
} from "./research.type.js";
import {
  destroyReferenceImageFromCloudinary,
  uploadReferenceImageToR2,
  ReferenceImageDestroyer,
} from "./research.storage.js";
import { buildReferenceImageKey, copyObject, deleteObject, headObject, readObjectRange } from "../storage/r2.js";
import { fetchSafeImageBuffer } from "./research.referenceImage.js";
import { detectCanonicalImageSignature, MAX_REFERENCE_IMAGE_SIZE_BYTES } from "./research.storage.js";
import { ReferenceImageUploadPurpose, verifyReferenceImageUploadSession } from "./research.reference-image-session.js";
import { buildTempReferenceImageKey, getPresignedReferenceImagePutUrl } from "../storage/r2.js";
import { signReferenceImageUploadSession } from "./research.reference-image-session.js";
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
  targetProduct: true,
  referenceImageUrl: true,
  referenceImageStorageKey: true,
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
  uploadSessionToken?: string;
};

const finalizeDirectReferenceImage = async (input: { token: string; workspaceId: string; userId: string; purpose: ReferenceImageUploadPurpose; researchItemId?: string }) => {
  const session = verifyReferenceImageUploadSession(input.token);
  if (session.purpose !== input.purpose || session.workspaceId !== input.workspaceId || session.userId !== input.userId || session.researchItemId !== input.researchItemId) throw new ApiError(403, "Reference image upload session does not match this request");
  try {
    const metadata = await headObject(session.tempStorageKey);
    if (!metadata.contentLength || metadata.contentLength > MAX_REFERENCE_IMAGE_SIZE_BYTES || metadata.contentLength !== session.expectedSize) throw new ApiError(400, "Uploaded reference image size could not be verified");
    const signature = detectCanonicalImageSignature(await readObjectRange(session.tempStorageKey));
    if (!signature) throw new ApiError(400, "Uploaded reference image has an invalid binary signature");
    const storageKey = buildReferenceImageKey({ workspaceId: input.workspaceId, ext: signature.extension });
    await copyObject(session.tempStorageKey, storageKey, signature.mimeType);
    return { storageKey, tempStorageKey: session.tempStorageKey };
  } catch (error) {
    await deleteObject(session.tempStorageKey).catch(() => undefined);
    throw error;
  }
};

export const presignReferenceImageUpload = async (input: { workspaceId: string; userId: string; purpose: ReferenceImageUploadPurpose; expectedSize: number; contentType: string; researchItemId?: string }) => {
  const tempStorageKey = buildTempReferenceImageKey(input.workspaceId);
  const sessionToken = signReferenceImageUploadSession({
    purpose: input.purpose, workspaceId: input.workspaceId, userId: input.userId,
    tempStorageKey, expectedSize: input.expectedSize, researchItemId: input.researchItemId,
  });
  return { uploadUrl: await getPresignedReferenceImagePutUrl({ storageKey: tempStorageKey, contentType: input.contentType }), sessionToken };
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
  const existingOccurrenceCount = await prisma.researchItem.count({
    where: { workspaceId, etsyListingId },
  });

  if (existingOccurrenceCount > 0 && !input.reuseReference) {
    const existingItem = await prisma.researchItem.findFirst({
      where: { workspaceId, etsyListingId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: duplicateResearchItemSelect,
    });
    const duplicateData: DuplicateResearchItemData = isAdmin
      && existingItem ? {
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
  let referenceImageStorageKey: string | null = null;
  let temporaryReferenceImageStorageKey: string | null = null;
  let itemTitle: string | null = null;

  if (options?.uploadSessionToken) {
    // 2a. Manual image file provided: validate and upload to private R2 first.
    const uploadResult = await finalizeDirectReferenceImage({ token: options.uploadSessionToken, workspaceId, userId, purpose: "CREATE_RESEARCH_REFERENCE_IMAGE" });
    referenceImageStorageKey = uploadResult.storageKey;
    temporaryReferenceImageStorageKey = uploadResult.tempStorageKey;

    const metadata = await fetchEtsyListingFromApi(etsyListingId);
    itemTitle = metadata.title;
  } else {
    const metadata = await fetchEtsyListingFromApi(etsyListingId);
    itemTitle = metadata.title;
    if (metadata.referenceImageUrl) {
      const uploadResult = await uploadReferenceImageToR2({ workspaceId, buffer: await fetchSafeImageBuffer(metadata.referenceImageUrl) });
      referenceImageStorageKey = uploadResult.storageKey;
    }
  }

  // 3. Invariant check: A research item must NEVER be created without a reference image
  if (!referenceImageStorageKey) {
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

      const existingOccurrenceCount = await tx.researchItem.count({
        where: { workspaceId, etsyListingId },
      });
      if (existingOccurrenceCount > 0 && !input.reuseReference) {
        throw new ApiError(
          409,
          "This Etsy listing has already been added to this workspace",
          true,
          "",
          { alreadyExists: true },
        );
      }

      if (input.reuseReference) {
        const windowStart = new Date(Date.now() - 3_000);
        const recentOwnOccurrence = await tx.researchItem.findFirst({
          where: {
            workspaceId,
            createdById: userId,
            etsyListingId,
            createdAt: { gte: windowStart },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, createdAt: true },
        });
        if (recentOwnOccurrence) {
          throw new ApiError(
            409,
            "A research item for this reference was just created. Please wait a moment before adding again.",
            true,
            "",
            { code: "RAPID_SUBMISSION_GUARD" },
          );
        }
      }

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
          targetProduct: input.targetProduct ?? null,
          referenceImageUrl: null,
          referenceImagePublicId: null,
          referenceImageStorageKey,
          referenceImageStorageProvider: ReferenceImageStorageProvider.R2,
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

    const { referenceImageStorageKey: createdStorageKey, ...safeCreatedItem } = createdItem;
    if (temporaryReferenceImageStorageKey) {
      await deleteObject(temporaryReferenceImageStorageKey).catch(() => {
        console.warn("[STORAGE_CLEANUP_WARNING] Failed to delete promoted temporary reference image", { workspaceId });
      });
    }
    return {
      ...safeCreatedItem,
      hasReferenceImage: Boolean(createdStorageKey || safeCreatedItem.referenceImageUrl),
    };
  } catch (error) {
    // Roll back the uploaded R2 asset if the DB transaction failed.
    if (referenceImageStorageKey) {
      try {
        await deleteObject(referenceImageStorageKey);
      } catch {
        console.warn("[STORAGE_CLEANUP_WARNING] Failed to delete rolled-back R2 reference image", { workspaceId });
      }
    }
    if (temporaryReferenceImageStorageKey) await deleteObject(temporaryReferenceImageStorageKey).catch(() => undefined);

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
  targetProduct: true,
  referenceImageUrl: true,
  referenceImageStorageKey: true,
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
  targetProduct: true,
  referenceImageUrl: true,
  referenceImageStorageKey: true,
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
type GetResearchItemsServiceQuery = GetResearchItemsQueryInput & {
  stageSort?: "issue_fifo" | "issue_newest";
};

const researchStatusGroups: Record<string, ResearchStatus[]> = {
  waiting: [ResearchStatus.RESEARCHED],
  in_design: [
    ResearchStatus.ASSIGNED,
    ResearchStatus.DESIGN_IN_PROGRESS,
    ResearchStatus.DESIGN_REVIEW,
    ResearchStatus.CORRECTION_NEEDED,
    ResearchStatus.ISSUE_REPORTED,
    ResearchStatus.DESIGN_APPROVED,
  ],
  in_listing: [ResearchStatus.READY_FOR_LISTING, ResearchStatus.LISTING_IN_PROGRESS],
  listed: [ResearchStatus.LISTED],
};

export const getResearchItems = async (
  workspaceId: string,
  query: GetResearchItemsServiceQuery,
  userId: string,
  roles: readonly WorkspaceRole[]
): Promise<ResearchItemListResult> => {
  const { page, limit, createdBy, status, statusGroup, date, dateFrom, dateTo, search, assignment, sort, stageSort } = query;
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
  } else if (statusGroup && statusGroup !== "all") {
    where.status = { in: researchStatusGroups[statusGroup] };
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

  const createdAtRange = buildDateRangeFilter(dateFrom, dateTo);
  if (createdAtRange) {
    where.createdAt = createdAtRange;
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
      orderBy:
        stageSort === "issue_fifo"
          ? [
              { issueReportedAt: { sort: "asc", nulls: "last" } },
              { id: "asc" },
            ]
          : stageSort === "issue_newest"
            ? [
                { issueReportedAt: { sort: "desc", nulls: "last" } },
                { id: "desc" },
              ]
          : sort === "oldest"
          ? [{ createdAt: "asc" }, { id: "asc" }]
          : sort === "updated"
            ? [{ updatedAt: "desc" }, { id: "desc" }]
            : [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
    }),
    prisma.researchItem.count({ where }),
  ]);

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  const itemIds = rawItems.map((item) => item.id);
  const reviewActivityMap = await getResearchReviewActivityMap(itemIds);
  const usageCountByEtsyListingId = new Map<string, number>();

  if (rawItems.length > 0) {
    const etsyListingIds = [...new Set(rawItems.map((item) => item.etsyListingId))];
    const usageCounts = await prisma.researchItem.groupBy({
      by: ["etsyListingId"],
      where: {
        workspaceId,
        etsyListingId: { in: etsyListingIds },
      },
      _count: { _all: true },
    });

    for (const usageCount of usageCounts) {
      usageCountByEtsyListingId.set(
        usageCount.etsyListingId,
        usageCount._count._all,
      );
    }
  }

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
      targetProduct: item.targetProduct,
      referenceImageUrl: item.referenceImageUrl,
      hasReferenceImage: Boolean(item.referenceImageStorageKey || item.referenceImageUrl),
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
      usageCount: usageCountByEtsyListingId.get(item.etsyListingId) ?? 1,
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

export const getReferenceUsageHistory = async (
  workspaceId: string,
  etsyListingId: string,
  query: GetReferenceUsageHistoryQueryInput,
): Promise<ReferenceUsageHistoryResult> => {
  const { page, limit } = query;
  const where = { workspaceId, etsyListingId };
  const skip = (page - 1) * limit;

  const [items, total] = await prisma.$transaction([
    prisma.researchItem.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        status: true,
        targetProduct: true,
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
    }),
    prisma.researchItem.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
};

export const getResearchSummary = async (
  workspaceId: string,
  userId: string,
  query: GetResearchSummaryQueryInput
) => {
  const baseWhere: Prisma.ResearchItemWhereInput = {
    workspaceId,
    createdById: userId,
  };
  const createdAtRange = buildDateRangeFilter(query.dateFrom, query.dateTo);
  if (createdAtRange) {
    baseWhere.createdAt = createdAtRange;
  }

  const countFor = (statuses?: ResearchStatus[]) =>
    prisma.researchItem.count({
      where: statuses ? { ...baseWhere, status: { in: statuses } } : baseWhere,
    });

  const [totalResearched, waiting, inDesign, inListing, listed] =
    await Promise.all([
      countFor(),
      countFor(researchStatusGroups.waiting),
      countFor(researchStatusGroups.in_design),
      countFor(researchStatusGroups.in_listing),
      countFor(researchStatusGroups.listed),
    ]);

  return {
    totalResearched,
    waiting,
    inDesign,
    inListing,
    listed,
  };
};

// Retrieves the ADMIN issue queue with stage-specific ordering while preserving
// the generic research list's public sort contract.
export const getIssueItems = async (
  workspaceId: string,
  query: GetIssueItemsQueryInput,
  userId: string,
  roles: readonly WorkspaceRole[]
): Promise<ResearchItemListResult> =>
  getResearchItems(
    workspaceId,
    {
      limit: query.limit,
      page: query.page,
      search: query.search,
      status: ResearchStatus.ISSUE_REPORTED,
      stageSort: query.sort === "newest" ? "issue_newest" : "issue_fifo",
    },
    userId,
    roles
  );

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
    targetProduct: researchItem.targetProduct,
    referenceImageUrl: researchItem.referenceImageUrl,
    hasReferenceImage: Boolean(researchItem.referenceImageStorageKey || researchItem.referenceImageUrl),
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
): Promise<{
  id: string;
  referenceImageUrl: string | null;
  referenceImagePublicId: string | null;
  referenceImageStorageKey: string | null;
  referenceImageStorageProvider: ReferenceImageStorageProvider;
}> => {
  const item = await prisma.researchItem.findFirst({
    where: {
      id: researchItemId,
      workspaceId,
    },
    select: {
      id: true,
      createdById: true,
      referenceImageUrl: true,
      referenceImagePublicId: true,
      referenceImageStorageKey: true,
      referenceImageStorageProvider: true,
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

  const referenceImageUrl = item.referenceImageUrl?.trim() || null;
  if (!item.referenceImageStorageKey && !referenceImageUrl) {
    throw new ApiError(404, "Reference image not available");
  }

  return {
    id: item.id,
    referenceImageUrl,
    referenceImagePublicId: item.referenceImagePublicId,
    referenceImageStorageKey: item.referenceImageStorageKey,
    referenceImageStorageProvider: item.referenceImageStorageProvider,
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
        data: {
          status: ResearchStatus.ASSIGNED,
          issueReportedAt: null,
        },
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
  userId: string,
  input: PreviewResearchItemInput,
  actorRoles: readonly WorkspaceRole[],
): Promise<ResearchPreviewResult> => {
  const isAdmin = actorRoles.includes(WorkspaceRole.ADMIN);
  const { normalizedUrl, etsyListingId } = extractEtsyListing(input.etsyUrl);

  const usageWhere = { workspaceId, etsyListingId };
  const [usageCount, currentUserUsageCount, currentUserLatestOccurrence] =
    await Promise.all([
      prisma.researchItem.count({ where: usageWhere }),
      prisma.researchItem.count({ where: { ...usageWhere, createdById: userId } }),
      prisma.researchItem.findFirst({
        where: { ...usageWhere, createdById: userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          createdAt: true,
          status: true,
          targetProduct: true,
        },
      }),
    ]);

  const metadata = await fetchEtsyListingFromApi(etsyListingId);

  return {
    etsyListingId,
    normalizedUrl,
    title: metadata.title,
    referenceImageUrl: metadata.referenceImageUrl,
    alreadyExists: usageCount > 0,
    usageCount,
    currentUserUsageCount,
    currentUserLatestOccurrence: currentUserLatestOccurrence
      ? {
          researchItemId: currentUserLatestOccurrence.id,
          createdAt: currentUserLatestOccurrence.createdAt,
          status: currentUserLatestOccurrence.status,
          targetProduct: currentUserLatestOccurrence.targetProduct,
        }
      : null,
    canViewUsageDetails: isAdmin,
    canAddAgain: actorRoles.includes(WorkspaceRole.RESEARCHER),
  };
};

export type UploadReferenceImageOptions = {
  destroyer?: ReferenceImageDestroyer;
};

// Manually uploads and updates the reference image in R2 before cleaning any legacy asset.
export const uploadResearchReferenceImage = async (
  workspaceId: string,
  researchItemId: string,
  actorUserId: string,
  actorRoles: readonly WorkspaceRole[],
  uploadSessionToken: string,
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
      referenceImageStorageKey: true,
      referenceImageStorageProvider: true,
      referenceImagePublicId: true,
    },
  });

  if (!existingItem) {
    throw new ApiError(404, "Research item not found");
  }

  const uploadResult = await finalizeDirectReferenceImage({
    token: uploadSessionToken,
    workspaceId,
    userId: actorUserId,
    purpose: "REPLACE_RESEARCH_REFERENCE_IMAGE",
    researchItemId,
  });

  try {
    await prisma.researchItem.update({
      where: {
        id: researchItemId,
        workspaceId,
      },
      data: {
        referenceImageUrl: null,
        referenceImagePublicId: null,
        referenceImageStorageKey: uploadResult.storageKey,
        referenceImageStorageProvider: ReferenceImageStorageProvider.R2,
      },
    });
  } catch (dbError) {
    await deleteObject(uploadResult.storageKey).catch(() => undefined);
    await deleteObject(uploadResult.tempStorageKey).catch(() => undefined);
    throw dbError;
  }

  if (existingItem.referenceImageStorageProvider === ReferenceImageStorageProvider.R2 && existingItem.referenceImageStorageKey) {
    await deleteObject(existingItem.referenceImageStorageKey);
  } else if (existingItem.referenceImagePublicId) {
    const destroyer =
      options?.destroyer ?? destroyReferenceImageFromCloudinary;
    await destroyer(existingItem.referenceImagePublicId);
  }

  await deleteObject(uploadResult.tempStorageKey).catch(() => {
    console.warn("[STORAGE_CLEANUP_WARNING] Failed to delete promoted temporary reference image", { workspaceId, researchItemId });
  });

  return {
    researchItemId: existingItem.id,
    hasReferenceImage: true,
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

  const { referenceImageStorageKey, ...safeUpdatedItem } = updatedItem;
  return {
    ...safeUpdatedItem,
    hasReferenceImage: Boolean(referenceImageStorageKey || safeUpdatedItem.referenceImageUrl),
  };
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
        referenceImageStorageKey: true,
        referenceImageStorageProvider: true,
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
      referenceImageStorageKey: item.referenceImageStorageKey,
      referenceImageStorageProvider: item.referenceImageStorageProvider,
      reviewImagePublicIds,
      finalAssetStorageKeys,
    };
  });

  // 2. Post-commit external storage cleanup (best-effort, fully awaited)
  await cleanupExternalAssets({
    researchItemId: cleanupMetadata.researchItemId,
    referenceImagePublicId: cleanupMetadata.referenceImagePublicId,
    referenceImageStorageKey: cleanupMetadata.referenceImageStorageKey,
    referenceImageStorageProvider: cleanupMetadata.referenceImageStorageProvider,
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
  referenceImageStorageKey: string | null;
  referenceImageStorageProvider: ReferenceImageStorageProvider;
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
    referenceImageStorageKey,
    referenceImageStorageProvider,
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

  if (
    referenceImageStorageProvider === ReferenceImageStorageProvider.R2 &&
    referenceImageStorageKey
  ) {
    cleanupTasks.push(
      removeR2Object(referenceImageStorageKey).catch((error: unknown) => {
        console.warn("[STORAGE_CLEANUP_WARNING] Failed to delete reference image from R2", {
          researchItemId,
          provider: "r2",
          storageKey: referenceImageStorageKey,
          error: error instanceof Error ? error.message : String(error),
        });
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
