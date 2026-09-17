import { ResearchStatus } from "@prisma/client";

export type DesignerQueueResearchItem = {
  id: string;
  etsyListingId: string;
  originalUrl: string;
  normalizedUrl: string;
  title: string | null;
  referenceImageUrl: string | null;
  status: ResearchStatus;
  createdAt: Date;
  updatedAt: Date;
  createdBy: {
    id: string;
    name: string | null;
    email: string;
  };
};

export type DesignerWorkQueueItem = {
  assignmentId: string;
  assignedAt: Date;
  startedAt: Date | null;
  researchItem: DesignerQueueResearchItem;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type DesignerWorkQueueResult = {
  items: DesignerWorkQueueItem[];
  pagination: PaginationMeta;
};

export type AdminDesignListItem = {
  id: string;
  etsyListingId: string;
  originalUrl: string;
  normalizedUrl: string;
  title: string | null;
  referenceImageUrl: string | null;
  status: ResearchStatus;
  createdAt: Date;
  updatedAt: Date;
  currentDesigner: {
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
  latestReview: {
    id: string;
    roundNumber: number;
    submittedAt: Date;
    approvedAt: Date | null;
  } | null;
  latestIssueReport: {
    id: string;
    reason: string;
    details: string | null;
    createdAt: Date;
  } | null;
};

export type AdminDesignListResult = {
  items: AdminDesignListItem[];
  pagination: PaginationMeta;
};

export type StartDesignWorkResult = {
  researchItem: {
    id: string;
    status: ResearchStatus;
  };
  assignment: {
    id: string;
    designerId: string;
    startedAt: Date | null;
    isCurrent: boolean;
  };
};

export type ReportDesignIssueResult = {
  researchItem: {
    id: string;
    status: ResearchStatus;
  };
  issueReport: {
    id: string;
    reason: string;
    details: string | null;
    createdAt: Date;
  };
};

export const NOTIFICATION_TYPE_DESIGN_ISSUE_REPORTED =
  "DESIGN_ISSUE_REPORTED" as const;

export type SubmitDesignReviewResult = {
  researchItem: {
    id: string;
    status: ResearchStatus;
  };
  reviewSubmission: {
    id: string;
    roundNumber: number;
    imageUrl: string | null;
    imageDeletedAt: Date | null;
    note: string | null;
    submittedAt: Date;
  };
};

export const NOTIFICATION_TYPE_DESIGN_REVIEW_SUBMITTED =
  "DESIGN_REVIEW_SUBMITTED" as const;

export type StartCorrectionResult = {
  researchItem: {
    id: string;
    status: ResearchStatus;
  };
};

export type UploadedFinalAssetItem = {
  id: string;
  fileName: string;
  fileSize: string;
  mimeType: string;
};

export type UploadFinalAssetsResult = {
  researchItem: {
    id: string;
    status: ResearchStatus;
  };
  finalAssets: UploadedFinalAssetItem[];
};

export type FinalAssetIncomingFile = {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
};

export type FinalAssetMultipartInitResult = {
  sessionToken: string;
  partSize: number;
  partCount: number;
  parts: Array<{
    partNumber: number;
    uploadUrl: string;
  }>;
};

export type FinalAssetMultipartCompletePart = {
  partNumber: number;
  eTag: string;
};

export type CompleteDesignResult = {
  researchItem: {
    id: string;
    status: ResearchStatus;
  };
  finalAssetCount: number;
  completedAt: Date;
};
