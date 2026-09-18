import { ResearchStatus } from "@prisma/client";

export type ReviewUserSummary = {
  id: string;
  name: string | null;
  email: string;
  profileImageUrl: string | null;
};

export type ReviewAssignmentSummary = {
  id: string;
  designerId: string;
  assignedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  isCurrent: boolean;
};

export type ReviewQueueItem = {
  review: {
    id: string;
    roundNumber: number;
    imageUrl: string | null;
    imageDeletedAt: Date | null;
    note: string | null;
    submittedAt: Date;
  };
  researchItem: {
    id: string;
    etsyListingId: string;
    title: string | null;
    status: ResearchStatus;
    originalUrl: string;
    normalizedUrl: string;
  };
  designer: ReviewUserSummary | null;
};

export type ReviewQueueResult = {
  items: ReviewQueueItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type ReviewReplyDetail = {
  id: string;
  message: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: {
    id: string;
    name: string | null;
  };
};

export type ReviewAnnotationDetail = {
  id: string;
  x: number;
  y: number;
  comment: string;
  resolved: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: {
    id: string;
    name: string | null;
  };
  replies: ReviewReplyDetail[];
};

export type ReviewHistoryItem = {
  id: string;
  roundNumber: number;
  imageUrl: string | null;
  imageDeletedAt: Date | null;
  note: string | null;
  submittedAt: Date;
  approvedAt: Date | null;
  approvedById: string | null;
  annotations: ReviewAnnotationDetail[];
};

export type ReviewDetailResult = {
  researchItem: {
    id: string;
    etsyListingId: string;
    originalUrl: string;
    normalizedUrl: string;
    title: string | null;
    referenceImageUrl: string | null;
    status: ResearchStatus;
    createdAt: Date;
    updatedAt: Date;
    createdBy: ReviewUserSummary;
  };
  currentDesigner: ReviewUserSummary | null;
  currentDesignAssignment: ReviewAssignmentSummary | null;
  selectedReview: ReviewHistoryItem;
  latestReviewId: string;
  reviews: ReviewHistoryItem[];
};

export type ReviewAnnotationCreatedBy = {
  id: string;
  name: string | null;
};

export type ReviewAnnotationItem = {
  id: string;
  reviewSubmissionId: string;
  x: number;
  y: number;
  comment: string;
  resolved: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: ReviewAnnotationCreatedBy;
};

export type CreateReviewAnnotationResult = {
  annotation: ReviewAnnotationItem;
};

export type UpdateReviewAnnotationResult = {
  annotation: ReviewAnnotationItem;
};

export type DeleteReviewAnnotationResult = {
  annotationId: string;
};

export type AnnotationReplyCreatedBy = {
  id: string;
  name: string | null;
};

export type AnnotationReplyItem = {
  id: string;
  annotationId: string;
  message: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: AnnotationReplyCreatedBy;
};

export type CreateAnnotationReplyResult = {
  reply: AnnotationReplyItem;
};

export type UpdateAnnotationReplyResult = {
  reply: AnnotationReplyItem;
};

export type DeleteAnnotationReplyResult = {
  replyId: string;
};

export const NOTIFICATION_TYPE_DESIGN_CORRECTION_REQUESTED =
  "DESIGN_CORRECTION_REQUESTED" as const;

export type RequestCorrectionResult = {
  researchItem: {
    id: string;
    status: ResearchStatus;
  };
};

export const NOTIFICATION_TYPE_DESIGN_APPROVED = "DESIGN_APPROVED" as const;

export type ApproveReviewResult = {
  researchItem: {
    id: string;
    status: ResearchStatus;
  };
  reviewSubmission: {
    id: string;
    roundNumber: number;
    approvedAt: Date;
    approvedById: string;
  };
};
