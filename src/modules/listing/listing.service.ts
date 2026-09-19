import { Prisma, ResearchStatus, WorkspaceRole } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import { ApiError } from "../../shared/ApiError.js";
import { extractEtsyListing } from "../research/research.helper.js";
import {
  ACTIVE_LISTING_WORKLOAD_STATUSES,
  acquireWorkspaceListerLock,
  assignLeastWorkloadLister,
} from "./listing.assignment.js";
import { acquireWorkspaceMemberMutationLock } from "../workspace/workspace.member-lock.js";
import { getRoleAssignmentEligibilityFilter } from "../workspace/workspace.assignment-eligibility.js";
import { getObjectStream } from "../storage/r2.js";
import {
  AdminListingListItem,
  AdminListingListResult,
  BackfillListingResult,
  CompleteListingResult,
  FinalAssetDownloadDescriptor,
  ListerListingDetailResult,
  ListerWorkQueueItem,
  ListerWorkQueueResult,
  StartListingResult,
  NOTIFICATION_TYPE_LISTING_ASSIGNED,
} from "./listing.type.js";
import {
  ADMIN_LISTING_WORKFLOW_STATUSES,
  BulkAssignListingBodyInput,
  CompleteListingBodyInput,
  GetAdminListingListQueryInput,
  GetListerWorkQueueQueryInput,
  LISTER_QUEUE_ACTIVE_STATUSES,
} from "./listing.validation.js";

const LISTER_DOWNLOAD_STATUSES = new Set<ResearchStatus>([
  ResearchStatus.READY_FOR_LISTING,
  ResearchStatus.LISTING_IN_PROGRESS,
  ResearchStatus.LISTED,
]);

const LISTER_DETAIL_STATUSES = new Set<ResearchStatus>(
  LISTER_QUEUE_ACTIVE_STATUSES
);

export const safeListerWorkQueueSelect = {
  id: true,
  researchItem: {
    select: {
      id: true,
      etsyListingId: true,
      originalUrl: true,
      title: true,
      status: true,
      reviewSubmissions: {
        where: {
          approvedAt: { not: null },
        },
        orderBy: {
          roundNumber: "desc",
        },
        take: 1,
        select: {
          imageUrl: true,
          imageDeletedAt: true,
        },
      },
      finalAssets: {
        orderBy: { uploadedAt: "asc" },
        take: 1,
        select: {
          id: true,
        },
      },
    },
  },
} as const;

// Retrieves the active work queue for an authenticated lister in a workspace.
export const getListerWorkQueue = async (
  workspaceId: string,
  listerId: string,
  query: GetListerWorkQueueQueryInput
): Promise<ListerWorkQueueResult> => {
  const { page, limit, status, search } = query;

  const researchItemWhere: Prisma.ResearchItemWhereInput = {
    workspaceId,
    status: status ? status : { in: [...LISTER_QUEUE_ACTIVE_STATUSES] },
  };

  if (search) {
    researchItemWhere.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { etsyListingId: { contains: search, mode: "insensitive" } },
      { normalizedUrl: { contains: search, mode: "insensitive" } },
      { originalUrl: { contains: search, mode: "insensitive" } },
    ];
  }

  const where: Prisma.ListingAssignmentWhereInput = {
    listerId,
    isCurrent: true,
    researchItem: researchItemWhere,
  };

  const skip = (page - 1) * limit;

  const [assignments, total] = await prisma.$transaction([
    prisma.listingAssignment.findMany({
      where,
      select: safeListerWorkQueueSelect,
      orderBy: [
        { assignedAt: "desc" },
        { id: "desc" },
      ],
      skip,
      take: limit,
    }),
    prisma.listingAssignment.count({ where }),
  ]);

  const items: ListerWorkQueueItem[] = assignments.map((assignment) => {
    const rawPreview = assignment.researchItem.reviewSubmissions[0] ?? null;
    const preview = rawPreview
      ? {
          imageUrl:
            rawPreview.imageDeletedAt === null ? rawPreview.imageUrl : null,
          imageDeletedAt: rawPreview.imageDeletedAt,
        }
      : null;

    return {
      assignmentId: assignment.id,
      researchItem: {
        id: assignment.researchItem.id,
        etsyListingId: assignment.researchItem.etsyListingId,
        originalUrl: assignment.researchItem.originalUrl,
        title: assignment.researchItem.title,
        status: assignment.researchItem.status,
      },
      preview,
      finalAssetId: assignment.researchItem.finalAssets[0]?.id ?? null,
    };
  });

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

// Retrieves active listing detail only for the current assigned lister.
export const getListerListingDetail = async (
  workspaceId: string,
  researchItemId: string,
  listerId: string
): Promise<ListerListingDetailResult> => {
  const researchItem = await prisma.researchItem.findFirst({
    where: {
      id: researchItemId,
      workspaceId,
    },
    select: {
      id: true,
      etsyListingId: true,
      title: true,
      originalUrl: true,
      normalizedUrl: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          profileImageUrl: true,
        },
      },
      designAssignments: {
        where: { isCurrent: true },
        orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          designer: {
            select: {
              id: true,
              name: true,
              profileImageUrl: true,
            },
          },
        },
      },
      listingAssignments: {
        where: { isCurrent: true },
        orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          id: true,
          listerId: true,
          assignedAt: true,
          startedAt: true,
          completedAt: true,
          isCurrent: true,
        },
      },
      reviewSubmissions: {
        where: { approvedAt: { not: null } },
        orderBy: [{ roundNumber: "desc" }, { id: "desc" }],
        take: 1,
        select: {
          id: true,
          roundNumber: true,
          imageUrl: true,
          imageDeletedAt: true,
          approvedAt: true,
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
          storageDeletedAt: true,
        },
      },
    },
  });

  if (!researchItem) {
    throw new ApiError(404, "Research item not found");
  }

  const listingAssignment = researchItem.listingAssignments[0] ?? null;
  if (!listingAssignment) {
    throw new ApiError(409, "No active assignment found for this research item");
  }

  if (listingAssignment.listerId !== listerId) {
    throw new ApiError(403, "You are not assigned to this research item");
  }

  if (!LISTER_DETAIL_STATUSES.has(researchItem.status)) {
    throw new ApiError(
      409,
      `Listing detail is not available for research item with status ${researchItem.status}`
    );
  }

  const rawApprovedPreview = researchItem.reviewSubmissions[0] ?? null;
  const approvedPreview = rawApprovedPreview?.approvedAt
    ? {
        reviewId: rawApprovedPreview.id,
        roundNumber: rawApprovedPreview.roundNumber,
        imageUrl:
          rawApprovedPreview.imageDeletedAt === null
            ? rawApprovedPreview.imageUrl
            : null,
        imageDeletedAt: rawApprovedPreview.imageDeletedAt,
        approvedAt: rawApprovedPreview.approvedAt,
      }
    : null;

  return {
    researchItem: {
      id: researchItem.id,
      etsyListingId: researchItem.etsyListingId,
      title: researchItem.title,
      originalUrl: researchItem.originalUrl,
      normalizedUrl: researchItem.normalizedUrl,
      status: researchItem.status,
      createdAt: researchItem.createdAt,
      updatedAt: researchItem.updatedAt,
    },
    creator: researchItem.createdBy,
    designer: researchItem.designAssignments[0]?.designer ?? null,
    listingAssignment: {
      id: listingAssignment.id,
      assignedAt: listingAssignment.assignedAt,
      startedAt: listingAssignment.startedAt,
      completedAt: listingAssignment.completedAt,
      isCurrent: listingAssignment.isCurrent,
    },
    approvedPreview,
    finalAssets: researchItem.finalAssets.map((asset) => ({
      id: asset.id,
      fileName: asset.fileName,
      fileSize: asset.fileSize.toString(),
      mimeType: asset.mimeType,
      uploadedAt: asset.uploadedAt,
      storageDeletedAt: asset.storageDeletedAt,
    })),
  };
};

// Sequentially assigns unassigned READY_FOR_LISTING backlog items to eligible listers using least-workload logic.
// Strictly never redistributes or touches items with an existing current assignment.
export const backfillUnassignedListings = async (
  workspaceId: string
): Promise<BackfillListingResult> => {
  return await prisma.$transaction(
    async (tx) => {
      const listerCount = await tx.workspaceMember.count({
        where: {
          workspaceId,
          ...getRoleAssignmentEligibilityFilter(WorkspaceRole.LISTER),
        },
      });

      if (listerCount === 0) {
        return { backfilledCount: 0, assignedItemIds: [] };
      }

      // Find all items in READY_FOR_LISTING status having zero current assignments
      const unassignedItems = await tx.researchItem.findMany({
        where: {
          workspaceId,
          status: ResearchStatus.READY_FOR_LISTING,
          listingAssignments: {
            none: {
              isCurrent: true,
            },
          },
        },
        select: {
          id: true,
        },
        orderBy: [
          { createdAt: "asc" },
          { id: "asc" },
        ],
      });

      const assignedItemIds: string[] = [];

      for (const item of unassignedItems) {
        const result = await assignLeastWorkloadLister(tx, workspaceId, item.id);
        if (result && result.isNew) {
          assignedItemIds.push(item.id);
        }
      }

      return {
        backfilledCount: assignedItemIds.length,
        assignedItemIds,
      };
    },
    {
      maxWait: 15000,
      timeout: 30000,
    }
  );
};

// Atomically transitions an assigned research item to in-progress and sets startedAt on the current listing assignment.
export const startListingWork = async (
  workspaceId: string,
  researchItemId: string,
  listerId: string
): Promise<StartListingResult> => {
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

      // 3. Status validation: allowed ONLY from READY_FOR_LISTING
      if (researchItem.status !== ResearchStatus.READY_FOR_LISTING) {
        throw new ApiError(
          409,
          `Cannot start listing for research item with status ${researchItem.status}`
        );
      }

      // 4. Fetch current assignment
      const currentAssignment = await tx.listingAssignment.findFirst({
        where: {
          researchItemId,
          isCurrent: true,
        },
        select: {
          id: true,
          listerId: true,
          startedAt: true,
        },
      });

      if (!currentAssignment) {
        throw new ApiError(
          409,
          "No active assignment found for this research item"
        );
      }

      // 5. Verify lister ownership of the current assignment
      if (currentAssignment.listerId !== listerId) {
        throw new ApiError(403, "You are not assigned to this research item");
      }

      // 6. Double-start protection: startedAt must be null
      if (currentAssignment.startedAt !== null) {
        throw new ApiError(409, "Listing work has already been started");
      }

      const now = new Date();

      // 7. Conditional atomic transition of ResearchItem status to LISTING_IN_PROGRESS
      const updatedItemResult = await tx.researchItem.updateMany({
        where: {
          id: researchItemId,
          workspaceId,
          status: ResearchStatus.READY_FOR_LISTING,
        },
        data: {
          status: ResearchStatus.LISTING_IN_PROGRESS,
          updatedAt: now,
        },
      });

      if (updatedItemResult.count !== 1) {
        throw new ApiError(
          409,
          "Listing work has already been started or status has changed"
        );
      }

      // 8. Conditional atomic update on current ListingAssignment
      const updatedAssignmentResult = await tx.listingAssignment.updateMany({
        where: {
          id: currentAssignment.id,
          researchItemId,
          listerId,
          isCurrent: true,
          startedAt: null,
        },
        data: {
          startedAt: now,
        },
      });

      if (updatedAssignmentResult.count !== 1) {
        throw new ApiError(409, "Listing work has already been started");
      }

      return {
        researchItem: {
          id: researchItem.id,
          status: ResearchStatus.LISTING_IN_PROGRESS,
        },
        assignment: {
          id: currentAssignment.id,
          startedAt: now,
        },
      };
    },
    {
      maxWait: 10000,
      timeout: 20000,
    }
  );
};

// Resolves an authorized final-asset media stream without exposing storage identifiers or credentials.
export const getAuthorizedFinalAssetDownload = async (
  workspaceId: string,
  assetId: string,
  userId: string
): Promise<FinalAssetDownloadDescriptor> => {
  const asset = await prisma.finalAsset.findFirst({
    where: {
      id: assetId,
      researchItem: {
        workspaceId,
      },
    },
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      storageKey: true,
      storageDeletedAt: true,
      researchItemId: true,
      researchItem: {
        select: {
          id: true,
          workspaceId: true,
          status: true,
        },
      },
    },
  });

  if (!asset) {
    throw new ApiError(404, "Final asset not found");
  }

  if (!LISTER_DOWNLOAD_STATUSES.has(asset.researchItem.status)) {
    throw new ApiError(409, "Final asset is not available at this workflow stage.");
  }

  const currentAssignment = await prisma.listingAssignment.findFirst({
    where: {
      researchItemId: asset.researchItemId,
      listerId: userId,
      isCurrent: true,
    },
    select: {
      id: true,
      listerId: true,
      isCurrent: true,
    },
  });

  if (!currentAssignment) {
    throw new ApiError(403, "You are not assigned to this research item");
  }

  if (asset.storageDeletedAt !== null) {
    throw new ApiError(
      410,
      "The production ZIP package for this listed item has been removed from storage."
    );
  }

  const stream = await getObjectStream(asset.storageKey);

  return {
    fileName: asset.fileName,
    fileSize: asset.fileSize,
    mimeType: asset.mimeType,
    stream,
  };
};

// Atomically completes listing work, preserves assignment history, and creates the sole listing result.
export const completeListingWork = async (
  workspaceId: string,
  researchItemId: string,
  listerId: string,
  input: CompleteListingBodyInput
): Promise<CompleteListingResult> => {
  const etsyListingUrl = input.etsyListingUrl
    ? extractEtsyListing(input.etsyListingUrl).normalizedUrl
    : null;

  return await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT id FROM "ResearchItem" WHERE id = ${researchItemId} FOR UPDATE`;

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

      if (researchItem.status !== ResearchStatus.LISTING_IN_PROGRESS) {
        throw new ApiError(
          409,
          `Cannot complete listing for research item with status ${researchItem.status}`
        );
      }

      const currentAssignment = await tx.listingAssignment.findFirst({
        where: {
          researchItemId,
          isCurrent: true,
        },
        select: {
          id: true,
          listerId: true,
          startedAt: true,
          completedAt: true,
        },
      });

      if (!currentAssignment) {
        throw new ApiError(409, "No active assignment found for this research item");
      }

      if (currentAssignment.listerId !== listerId) {
        throw new ApiError(403, "You are not assigned to this research item");
      }

      if (currentAssignment.startedAt === null) {
        throw new ApiError(409, "Listing work has not been started");
      }

      if (currentAssignment.completedAt !== null) {
        throw new ApiError(409, "Listing work has already been completed");
      }

      const existingResult = await tx.listingResult.findUnique({
        where: { researchItemId },
        select: { id: true },
      });

      if (existingResult) {
        throw new ApiError(409, "A listing result already exists for this research item");
      }

      const now = new Date();
      const itemUpdate = await tx.researchItem.updateMany({
        where: {
          id: researchItemId,
          workspaceId,
          status: ResearchStatus.LISTING_IN_PROGRESS,
        },
        data: {
          status: ResearchStatus.LISTED,
          updatedAt: now,
        },
      });

      if (itemUpdate.count !== 1) {
        throw new ApiError(409, "Listing status has changed");
      }

      const assignmentUpdate = await tx.listingAssignment.updateMany({
        where: {
          id: currentAssignment.id,
          researchItemId,
          listerId,
          isCurrent: true,
          startedAt: { not: null },
          completedAt: null,
        },
        data: {
          completedAt: now,
        },
      });

      if (assignmentUpdate.count !== 1) {
        throw new ApiError(409, "Listing work has already been completed");
      }

      const listingResult = await tx.listingResult.create({
        data: {
          researchItemId,
          etsyListingUrl,
          listedById: listerId,
          listedAt: now,
        },
        select: {
          id: true,
          etsyListingUrl: true,
          listedAt: true,
        },
      });

      return {
        researchItem: {
          id: researchItem.id,
          status: ResearchStatus.LISTED,
        },
        assignment: {
          id: currentAssignment.id,
          completedAt: now,
        },
        listingResult,
      };
    },
    {
      maxWait: 10000,
      timeout: 20000,
    }
  );
};

// Atomically assigns an unassigned READY_FOR_LISTING item to an explicit Lister.
// Explicit ADMIN targets are role-validated only and intentionally bypass automatic availability settings.
export const assignLister = async (
  workspaceId: string,
  researchItemId: string,
  listerId: string
) => {
  return await prisma.$transaction(
    async (tx) => {
      // Lock and validate item state before taking workspace advisory locks.
      const lockedItem = await tx.researchItem.updateMany({
        where: {
          id: researchItemId,
          workspaceId,
          status: ResearchStatus.READY_FOR_LISTING,
          listingAssignments: { none: { isCurrent: true } },
        },
        data: { updatedAt: new Date() },
      });

      if (lockedItem.count !== 1) {
        const workspaceItem = await tx.researchItem.count({
          where: { id: researchItemId, workspaceId },
        });

        if (workspaceItem === 0) {
          throw new ApiError(404, "Research item not found");
        }

        throw new ApiError(
          409,
          "Research item must be unassigned and READY_FOR_LISTING"
        );
      }

      await acquireWorkspaceMemberMutationLock(tx, workspaceId);
      await acquireWorkspaceListerLock(tx, workspaceId);

      const targetMember = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: listerId,
          },
        },
        select: { roles: true },
      });

      if (!targetMember?.roles.includes(WorkspaceRole.LISTER)) {
        throw new ApiError(400, "Selected user is not a lister in this workspace");
      }

      const revalidatedItem = await tx.researchItem.updateMany({
        where: {
          id: researchItemId,
          workspaceId,
          status: ResearchStatus.READY_FOR_LISTING,
          listingAssignments: { none: { isCurrent: true } },
        },
        data: { updatedAt: new Date() },
      });

      if (revalidatedItem.count !== 1) {
        throw new ApiError(
          409,
          "Research item must be unassigned and READY_FOR_LISTING"
        );
      }

      const assignment = await tx.listingAssignment.create({
        data: {
          researchItemId,
          listerId,
          isCurrent: true,
        },
        select: {
          id: true,
          listerId: true,
          assignedAt: true,
          isCurrent: true,
        },
      });
      await tx.notification.create({
        data: {
          workspaceId,
          userId: listerId,
          type: NOTIFICATION_TYPE_LISTING_ASSIGNED,
          title: "New Design Ready for Listing",
          message: "You have been assigned to list a new design.",
          researchItemId,
        },
      });

      return {
        researchItem: {
          id: researchItemId,
          status: ResearchStatus.READY_FOR_LISTING,
        },
        assignment,
      };
    },
    { maxWait: 10000, timeout: 15000 }
  );
};

// Atomically assigns selected unassigned listing items to an explicit Lister or
// distributes them among eligible Listers with deterministic balancing.
export const bulkAssignListers = async (
  workspaceId: string,
  input: BulkAssignListingBodyInput
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

      // Lock and validate items in a stable order before advisory locks.
      for (const researchItemId of lockedResearchItemIds) {
        const locked = await tx.researchItem.updateMany({
          where: {
            id: researchItemId,
            workspaceId,
            status: ResearchStatus.READY_FOR_LISTING,
            listingAssignments: { none: { isCurrent: true } },
          },
          data: { updatedAt: new Date() },
        });

        if (locked.count !== 1) {
          throw new ApiError(
            409,
            "All research items must be unassigned and READY_FOR_LISTING"
          );
        }
      }

      await acquireWorkspaceMemberMutationLock(tx, workspaceId);
      await acquireWorkspaceListerLock(tx, workspaceId);

      let listerIds: string[];

      if (input.mode === "TARGET") {
        const targetMember = await tx.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId,
              userId: input.listerId,
            },
          },
          select: { roles: true },
        });

        if (!targetMember?.roles.includes(WorkspaceRole.LISTER)) {
          throw new ApiError(400, "Selected user is not a lister in this workspace");
        }

        listerIds = input.researchItemIds.map(() => input.listerId);
      } else {
        const eligibleMembers = await tx.workspaceMember.findMany({
          where: {
            workspaceId,
            ...getRoleAssignmentEligibilityFilter(WorkspaceRole.LISTER),
          },
          select: {
            userId: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "asc" }, { userId: "asc" }],
        });

        if (eligibleMembers.length === 0) {
          throw new ApiError(409, "No eligible listers are available");
        }

        const workloadRows = await tx.listingAssignment.groupBy({
          by: ["listerId"],
          where: {
            listerId: { in: eligibleMembers.map((member) => member.userId) },
            isCurrent: true,
            researchItem: {
              workspaceId,
              status: { in: ACTIVE_LISTING_WORKLOAD_STATUSES },
            },
          },
          _count: { _all: true },
        });
        const workloadByListerId = new Map(
          workloadRows.map((row) => [row.listerId, row._count._all])
        );
        const candidates = eligibleMembers.map((member) => ({
          ...member,
          activeWorkload: workloadByListerId.get(member.userId) ?? 0,
        }));
        const [firstCandidate] = candidates;

        if (!firstCandidate) {
          throw new ApiError(409, "No eligible listers are available");
        }

        listerIds = input.researchItemIds.map(() => {
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

      // Revalidate after advisory locks and immediately before assignment writes.
      for (const researchItemId of lockedResearchItemIds) {
        const updated = await tx.researchItem.updateMany({
          where: {
            id: researchItemId,
            workspaceId,
            status: ResearchStatus.READY_FOR_LISTING,
            listingAssignments: { none: { isCurrent: true } },
          },
          data: { updatedAt: new Date() },
        });

        if (updated.count !== 1) {
          throw new ApiError(
            409,
            "All research items must be unassigned and READY_FOR_LISTING"
          );
        }
      }

      await tx.listingAssignment.createMany({
        data: input.researchItemIds.map((researchItemId, index) => ({
          researchItemId,
          listerId: listerIds[index],
          isCurrent: true,
        })),
      });
      await tx.notification.createMany({
        data: input.researchItemIds.map((researchItemId, index) => ({
          workspaceId,
          userId: listerIds[index],
          type: NOTIFICATION_TYPE_LISTING_ASSIGNED,
          title: "New Design Ready for Listing",
          message: "You have been assigned to list a new design.",
          researchItemId,
        })),
      });

      return {
        assignedCount: input.researchItemIds.length,
        assignedItemIds: input.researchItemIds,
      };
    },
    { maxWait: 15000, timeout: 30000 }
  );
};

export const getAdminListingList = async (
  workspaceId: string,
  query: GetAdminListingListQueryInput
): Promise<AdminListingListResult> => {
  const { page, limit, listerId, status, date, search, assignment } = query;

  const where: Prisma.ResearchItemWhereInput = {
    workspaceId,
    status: status ? status : { in: [...ADMIN_LISTING_WORKFLOW_STATUSES] },
  };

  if (listerId) {
    where.OR = [
      { listingAssignments: { some: { listerId } } },
      { listingResult: { listedById: listerId } },
    ];
  }

  if (assignment === "UNASSIGNED") {
    where.status = ResearchStatus.READY_FOR_LISTING;
    where.listingAssignments = { none: { isCurrent: true } };
  }

  if (date) {
    const [year, month, day] = date.split("-").map(Number);
    const startOfDay = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
    where.updatedAt = {
      gte: startOfDay,
      lt: nextDay,
    };
  }

  if (search) {
    const searchConditions: Prisma.ResearchItemWhereInput[] = [
      { title: { contains: search, mode: "insensitive" } },
      { etsyListingId: { contains: search, mode: "insensitive" } },
      { normalizedUrl: { contains: search, mode: "insensitive" } },
      { originalUrl: { contains: search, mode: "insensitive" } },
    ];
    if (where.OR) {
      where.AND = [
        { OR: where.OR },
        { OR: searchConditions },
      ];
      delete where.OR;
    } else {
      where.OR = searchConditions;
    }
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
        listingAssignments: {
          where: { isCurrent: true },
          take: 1,
          select: {
            id: true,
            assignedAt: true,
            startedAt: true,
            completedAt: true,
            lister: {
              select: {
                id: true,
                name: true,
                email: true,
                profileImageUrl: true,
              },
            },
          },
        },
        listingResult: {
          select: {
            id: true,
            etsyListingUrl: true,
            listedAt: true,
            listedBy: {
              select: {
                id: true,
                name: true,
                email: true,
                profileImageUrl: true,
              },
            },
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

  const items: AdminListingListItem[] = rawItems.map((item) => {
    const currentAssignment = item.listingAssignments[0] ?? null;

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
      currentLister:
        currentAssignment?.lister ?? item.listingResult?.listedBy ?? null,
      currentAssignment: currentAssignment
        ? {
            id: currentAssignment.id,
            assignedAt: currentAssignment.assignedAt,
            startedAt: currentAssignment.startedAt,
            completedAt: currentAssignment.completedAt,
          }
        : null,
      listingResult: item.listingResult,
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
