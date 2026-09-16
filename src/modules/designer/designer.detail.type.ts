import { ResearchStatus } from "@prisma/client";

export type DesignerDetailUser = {
  id: string;
  name: string | null;
  email: string;
};

export type DesignerDetailAnnotationReply = {
  id: string;
  message: string;
  createdAt: Date;
  createdBy: {
    id: string;
    name: string | null;
  };
};

export type DesignerDetailAnnotation = {
  id: string;
  x: number;
  y: number;
  comment: string;
  resolved: boolean;
  createdAt: Date;
  createdBy: {
    id: string;
    name: string | null;
  };
  replies: DesignerDetailAnnotationReply[];
};

export type DesignerDetailLatestReview = {
  id: string;
  roundNumber: number;
  imageUrl: string | null;
  imageDeletedAt: Date | null;
  note: string | null;
  submittedAt: Date;
  approvedAt: Date | null;
  annotations: DesignerDetailAnnotation[];
};

export type DesignWorkspaceReview = {
  id: string;
  roundNumber: number;
  imageUrl: string | null;
  imageDeletedAt: Date | null;
  note: string | null;
  submittedAt: Date;
  annotations: Array<{
    id: string;
    x: number;
    y: number;
    comment: string;
    createdAt: Date;
    createdBy: {
      name: string | null;
    };
    replies: Array<{
      id: string;
      message: string;
      createdAt: Date;
      createdBy: {
        name: string | null;
      };
    }>;
  }>;
};

export type DesignerDetailFinalAsset = {
  id: string;
  fileName: string;
  fileSize: string;
  mimeType: string;
  uploadedAt: Date;
};

export type DesignerDetailResult = {
  researchItem: {
    id: string;
    title: string | null;
    etsyListingId: string;
    originalUrl: string;
    status: ResearchStatus;
    createdAt: Date;
    updatedAt: Date;
  };
  researcher: DesignerDetailUser;
  assignment: {
    id: string;
    assignedAt: Date;
    startedAt: Date | null;
    isCurrent: true;
  };
  currentDesigner: DesignerDetailUser;
  latestReview: DesignerDetailLatestReview | null;
  reviewHistory: {
    previousReviews: DesignWorkspaceReview[];
  };
  latestIssue: {
    id: string;
    reason: string;
    details: string | null;
    createdAt: Date;
  } | null;
  finalAssets: {
    count: number;
    items: DesignerDetailFinalAsset[];
  };
};
