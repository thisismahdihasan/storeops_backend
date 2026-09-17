import { ResearchStatus } from "@prisma/client";
import { Readable } from "node:stream";

export const NOTIFICATION_TYPE_LISTING_ASSIGNED = "LISTING_ASSIGNED" as const;

export type ListerWorkload = {
  userId: string;
  createdAt: Date;
  activeWorkload: number;
};

export type AssignListerResult = {
  assignmentId: string;
  listerId: string;
  assignedAt: Date;
  isNew: boolean;
} | null;

export type BackfillListingResult = {
  backfilledCount: number;
  assignedItemIds: string[];
};

export type ListerQueueResearchItem = {
  id: string;
  etsyListingId: string;
  originalUrl: string;
  title: string | null;
  status: ResearchStatus;
};

export type ListerQueuePreview = {
  imageUrl: string | null;
  imageDeletedAt: Date | null;
} | null;

export type ListerWorkQueueItem = {
  assignmentId: string;
  researchItem: ListerQueueResearchItem;
  preview: ListerQueuePreview;
  finalAssetId: string | null;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ListerWorkQueueResult = {
  items: ListerWorkQueueItem[];
  pagination: PaginationMeta;
};

export type AdminListingListItem = {
  id: string;
  etsyListingId: string;
  originalUrl: string;
  normalizedUrl: string;
  title: string | null;
  referenceImageUrl: string | null;
  status: ResearchStatus;
  createdAt: Date;
  updatedAt: Date;
  currentLister: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  currentAssignment: {
    id: string;
    assignedAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  } | null;
  listingResult: {
    id: string;
    etsyListingUrl: string | null;
    listedAt: Date;
    listedBy: {
      id: string;
      name: string | null;
      email: string;
    };
  } | null;
};

export type AdminListingListResult = {
  items: AdminListingListItem[];
  pagination: PaginationMeta;
};

export type ListingDetailPerson = {
  id: string;
  name: string | null;
  profileImageUrl: string | null;
};

export type ListingApprovedPreview = {
  reviewId: string;
  roundNumber: number;
  imageUrl: string | null;
  imageDeletedAt: Date | null;
  approvedAt: Date;
} | null;

export type ListingDetailFinalAsset = {
  id: string;
  fileName: string;
  fileSize: string;
  mimeType: string;
  uploadedAt: Date;
};

export type ListerListingDetailResult = {
  researchItem: {
    id: string;
    etsyListingId: string;
    title: string | null;
    originalUrl: string;
    normalizedUrl: string;
    status: ResearchStatus;
    createdAt: Date;
    updatedAt: Date;
  };
  creator: ListingDetailPerson;
  designer: ListingDetailPerson | null;
  listingAssignment: {
    id: string;
    assignedAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    isCurrent: boolean;
  };
  approvedPreview: ListingApprovedPreview;
  finalAssets: ListingDetailFinalAsset[];
};

export type StartListingResult = {
  researchItem: {
    id: string;
    status: ResearchStatus;
  };
  assignment: {
    id: string;
    startedAt: Date;
  };
};

export type FinalAssetDownloadDescriptor = {
  fileName: string;
  fileSize: bigint;
  mimeType: string;
  stream: Readable;
};

export type CompleteListingResult = {
  researchItem: {
    id: string;
    status: ResearchStatus;
  };
  assignment: {
    id: string;
    completedAt: Date;
  };
  listingResult: {
    id: string;
    etsyListingUrl: string | null;
    listedAt: Date;
  };
};
