import { ResearchStatus, WorkspaceRole } from "@prisma/client";

export type DashboardDatePreset =
  | "all"
  | "today"
  | "week"
  | "month"
  | "custom";

export type ResolvedDashboardDateRange = {
  preset: DashboardDatePreset;
  dateFrom: string | null;
  dateTo: string | null;
};

export type DashboardPipelineCounts = {
  researched: number;
  assigned: number;
  designInProgress: number;
  designReview: number;
  correctionNeeded: number;
  issueReported: number;
  designApproved: number;
  readyForListing: number;
  listingInProgress: number;
  listed: number;
};

export type DashboardOverviewResult = {
  dateRange: ResolvedDashboardDateRange;
  totalResearch: number;
  pipeline: DashboardPipelineCounts;
};

export type ResearcherPerformanceRow = {
  userId: string;
  name: string | null;
  email: string;
  researchCount: number;
};

export type ResearcherPerformanceResult = {
  dateRange: ResolvedDashboardDateRange;
  researchers: ResearcherPerformanceRow[];
};

export type DesignerPerformanceRow = {
  userId: string;
  name: string | null;
  email: string;
  assignedCount: number;
  currentInProgress: number;
  submittedCount: number;
  approvedCount: number;
  correctionsCount: number;
  completedCount: number;
};

export type DesignerPerformanceResult = {
  dateRange: ResolvedDashboardDateRange;
  designers: DesignerPerformanceRow[];
};

export type ListerPerformanceRow = {
  userId: string;
  name: string | null;
  email: string;
  assignedCount: number;
  currentInProgress: number;
  listedCount: number;
};

export type ListerPerformanceResult = {
  dateRange: ResolvedDashboardDateRange;
  listers: ListerPerformanceRow[];
};

export type UserActivitySummaryResearch = {
  totalCreated: number;
};

export type UserActivitySummaryDesign = {
  assignedCount: number;
  currentInProgress: number;
  submittedCount: number;
  approvedCount: number;
  correctionsCount: number;
  completedCount: number;
};

export type UserActivitySummaryListing = {
  assignedCount: number;
  currentInProgress: number;
  listedCount: number;
};

export type UserActivitySummary = {
  research: UserActivitySummaryResearch | null;
  design: UserActivitySummaryDesign | null;
  listing: UserActivitySummaryListing | null;
};

export type UserActivityRecentItemRole = "RESEARCHER" | "DESIGNER" | "LISTER";

export type UserActivityMembershipStatus = "ACTIVE" | "REMOVED";

export type UserActivityRecentItem = {
  id: string;
  researchItemId: string;
  title: string | null;
  status: ResearchStatus;
  activityRole: UserActivityRecentItemRole;
  activityAt: string;
};

export type UserActivityUserInfo = {
  id: string;
  name: string | null;
  email: string;
  profileImageUrl: string | null;
  roles: WorkspaceRole[];
  membershipStatus: UserActivityMembershipStatus;
  joinedAt: string | null;
};

export type UserActivityResult = {
  dateRange: ResolvedDashboardDateRange;
  user: UserActivityUserInfo;
  summary: UserActivitySummary;
  recentItems: UserActivityRecentItem[];
};
