import { ResearchStatus } from "@prisma/client";

export type ParsedEtsyListing = {
  originalUrl: string;
  normalizedUrl: string;
  etsyListingId: string;
};

export type EtsyMetadata = {
  title: string | null;
  referenceImageUrl: string | null;
};

export type SafeResearchItem = {
  id: string;
  workspaceId: string;
  etsyListingId: string;
  originalUrl: string;
  normalizedUrl: string;
  title: string | null;
  targetProduct: string | null;
  referenceImageUrl: string | null;
  status: ResearchStatus;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};

export type DuplicateCreatorInfo = {
  id: string;
  name: string | null;
  email: string;
};

export type DuplicateResearchItemData =
  | {
      alreadyExists: true;
    }
  | {
      alreadyExists: true;
      researchItemId: string;
      createdBy: DuplicateCreatorInfo;
      currentStatus: ResearchStatus;
      createdAt: Date;
    };

export type ResearchItemReadItem = {
  id: string;
  workspaceId: string;
  etsyListingId: string;
  originalUrl: string;
  normalizedUrl: string;
  title: string | null;
  targetProduct: string | null;
  referenceImageUrl: string | null;
  status: ResearchStatus;
  createdAt: Date;
  updatedAt: Date;
  createdBy: DuplicateCreatorInfo;
};

export type ResearchReviewActivity = {
  designerReplyCount: number;
  latestDesignerReplyAt: Date | string | null;
  latestReviewId: string | null;
};

export type SafeResearchItemListItem = ResearchItemReadItem & {
  currentDesigner: CurrentDesigner | null;
  currentDesignAssignment: CurrentDesignAssignment | null;
  latestIssueReport: LatestIssueReportSummary | null;
  reviewActivity: ResearchReviewActivity;
  usageCount: number;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ResearchItemListResult = {
  items: SafeResearchItemListItem[];
  pagination: PaginationMeta;
};

export type CurrentDesigner = DuplicateCreatorInfo;

export type CurrentDesignAssignment = {
  id: string;
  designerId: string;
  assignedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  isCurrent: boolean;
};

export type LatestIssueReportSummary = {
  id: string;
  reason: string;
  details: string | null;
  createdAt: Date;
  reportedBy: DuplicateCreatorInfo;
};

export type LatestReviewSummary = {
  id: string;
  roundNumber: number;
  imageUrl: string | null;
  imageDeletedAt: Date | null;
  note: string | null;
  submittedAt: Date;
  approvedAt: Date | null;
  approvedById: string | null;
};

export type ResearchItemDetailResult = ResearchItemReadItem & {
  currentDesigner: CurrentDesigner | null;
  currentDesignAssignment: CurrentDesignAssignment | null;
  latestReview: LatestReviewSummary | null;
};

export type SafeResearchItemDetail = ResearchItemDetailResult;

export type ReassignedResearchItemData = {
  researchItem: {
    id: string;
    status: ResearchStatus;
  };
  assignment: {
    id: string;
    designerId: string;
    assignedAt: Date;
    isCurrent: boolean;
  };
};

export type PreviewOccurrence = {
  researchItemId: string;
  createdAt: Date;
  status: ResearchStatus;
  targetProduct: string | null;
};

export type ReferenceUsageHistoryItem = {
  createdAt: Date;
  createdBy: {
    id: string;
    name: string | null;
  };
  id: string;
  status: ResearchStatus;
  targetProduct: string | null;
};

export type ReferenceUsageHistoryResult = {
  items: ReferenceUsageHistoryItem[];
  pagination: PaginationMeta;
};

export type ResearchPreviewResult = {
  etsyListingId: string;
  normalizedUrl: string;
  title: string | null;
  referenceImageUrl: string | null;
  alreadyExists: boolean;
  usageCount: number;
  currentUserUsageCount: number;
  currentUserLatestOccurrence: PreviewOccurrence | null;
  canViewUsageDetails: boolean;
  canAddAgain: boolean;
};

export type ManualReferenceImageUploadResult = {
  researchItemId: string;
  referenceImageUrl: string;
};

export type DeleteResearchItemResult = {
  researchItemId: string;
};

export type BacklogSyncResult = {
  assignedCount: number;
  remainingUnassignedCount: number;
  designerCount: number;
};
