import { Prisma, ResearchStatus, WorkspaceRole } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import { NOTIFICATION_TYPE_DESIGN_ASSIGNED } from "../notification/notification.type.js";
import { acquireWorkspaceMemberMutationLock } from "../workspace/workspace.member-lock.js";
import { getRoleAssignmentEligibilityFilter } from "../workspace/workspace.assignment-eligibility.js";
import { BacklogSyncResult } from "./research.type.js";

// Statuses that count as active work in a Designer's current queue.
// Aligned with DESIGNER_QUEUE_ACTIVE_STATUSES in designer.validation.ts so that
// workload counting matches what actually appears in "My Work".
export const ACTIVE_DESIGN_STATUSES: ResearchStatus[] = [
  ResearchStatus.ASSIGNED,
  ResearchStatus.DESIGN_IN_PROGRESS,
  ResearchStatus.DESIGN_REVIEW,
  ResearchStatus.CORRECTION_NEEDED,
  ResearchStatus.ISSUE_REPORTED,
  ResearchStatus.DESIGN_APPROVED,
];

export type DesignerWorkload = {
  userId: string;
  createdAt: Date;
  activeWorkload: number;
};

// Sentinel thrown inside a Prisma transaction to force a full rollback when an item
// was already claimed concurrently. The outer loop catches and skips the item.
class BacklogItemSkippedError extends Error {
  constructor() {
    super("backlog-item-skipped");
    this.name = "BacklogItemSkippedError";
  }
}

// Identifies the workspace Designer with the lowest active workload who is currently eligible.
// Tie-breaks deterministically: lowest load → earliest membership createdAt → ascending userId.
// Accepts a TransactionClient so it can be called inside a transaction for fresh counts.
export const findLeastWorkloadDesigner = async (
  tx: Prisma.TransactionClient,
  workspaceId: string,
  now: Date = new Date()
): Promise<string | null> => {
  const eligibleMembers = await tx.workspaceMember.findMany({
    where: {
      workspaceId,
      ...getRoleAssignmentEligibilityFilter(WorkspaceRole.DESIGNER, now),
    },
    select: {
      userId: true,
      createdAt: true,
    },
    orderBy: [
      { createdAt: "asc" },
      { userId: "asc" },
    ],
  });

  if (eligibleMembers.length === 0) {
    return null;
  }

  if (eligibleMembers.length === 1) {
    return eligibleMembers[0].userId;
  }

  // One grouped query replaces per-member counts. The where clause is the exact
  // predicate previously applied per member: current assignments to eligible
  // designers whose research item is in this workspace with an active status.
  const workloadGroups = await tx.designAssignment.groupBy({
    by: ["designerId"],
    where: {
      designerId: { in: eligibleMembers.map((member) => member.userId) },
      isCurrent: true,
      researchItem: {
        workspaceId,
        status: { in: ACTIVE_DESIGN_STATUSES },
      },
    },
    _count: true,
  });

  const workloadByDesigner = new Map(
    workloadGroups.map((group) => [group.designerId, group._count])
  );

  // Members with no active assignments are absent from the grouped result and count as 0.
  const workloadCounts: DesignerWorkload[] = eligibleMembers.map((member) => ({
    userId: member.userId,
    createdAt: member.createdAt,
    activeWorkload: workloadByDesigner.get(member.userId) ?? 0,
  }));

  workloadCounts.sort((a, b) => {
    if (a.activeWorkload !== b.activeWorkload) {
      return a.activeWorkload - b.activeWorkload;
    }
    if (a.createdAt.getTime() !== b.createdAt.getTime()) {
      return a.createdAt.getTime() - b.createdAt.getTime();
    }
    return a.userId.localeCompare(b.userId);
  });

  return workloadCounts[0].userId;
};

// Assigns all currently unassigned RESEARCHED items in the workspace to the least-loaded
// eligible Designer. Items are processed sequentially so each iteration uses the updated
// workload after prior commits. Status transition (RESEARCHED → ASSIGNED), assignment
// creation, and notification are committed atomically in a single transaction per item.
// A concurrent conflict on the partial unique index (researchItemId WHERE isCurrent = true)
// causes a full rollback for that item — the status update is also rolled back, preserving
// the invariant that ASSIGNED status always has a current DesignAssignment.
export const assignUnassignedResearchBacklog = async (
  workspaceId: string
): Promise<BacklogSyncResult> => {
  const now = new Date();
  // Count eligible Designers for the early-exit path and the result summary.
  const designerCount = await prisma.workspaceMember.count({
    where: {
      workspaceId,
      ...getRoleAssignmentEligibilityFilter(WorkspaceRole.DESIGNER, now),
    },
  });

  // Fetch unassigned RESEARCHED candidates with valid reference images in deterministic order (oldest first).
  // Historical items with null referenceImageUrl are protected and never assigned.
  const candidates = await prisma.researchItem.findMany({
    where: {
      workspaceId,
      status: ResearchStatus.RESEARCHED,
      referenceImageUrl: { not: null },
      designAssignments: { none: { isCurrent: true } },
    },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  if (designerCount === 0 || candidates.length === 0) {
    return {
      assignedCount: 0,
      remainingUnassignedCount: candidates.length,
      designerCount,
    };
  }

  let assignedCount = 0;
  let stopLoop = false;

  for (const candidate of candidates) {
    if (stopLoop) break;

    try {
      const outcome = await prisma.$transaction(
        async (tx) => {
          await acquireWorkspaceMemberMutationLock(tx, workspaceId);

          // Re-query workload inside the transaction so each iteration reflects
          // workload updates from assignments committed in prior loop iterations.
          const designerId = await findLeastWorkloadDesigner(tx, workspaceId);
          if (!designerId) {
            // No Designers remain (e.g. all were removed mid-run). Return without
            // committing anything and signal the outer loop to stop.
            return "no-designer" as const;
          }

          // Conditional status gate: only proceed if the item is still RESEARCHED.
          // If a concurrent request already assigned it, count = 0 and we rollback.
          const updated = await tx.researchItem.updateMany({
            where: {
              id: candidate.id,
              status: ResearchStatus.RESEARCHED,
              referenceImageUrl: { not: null },
            },
            data: { status: ResearchStatus.ASSIGNED },
          });

          if (updated.count === 0) {
            // Item was concurrently claimed; throw to roll back this transaction entirely
            // (including any prior writes in this tx scope, of which there are none here).
            throw new BacklogItemSkippedError();
          }

          // Create the current assignment. The partial unique index on ("researchItemId")
          // WHERE "isCurrent" = true will reject a duplicate with P2002, rolling back
          // the entire transaction — including the status update above.
          await tx.designAssignment.create({
            data: {
              researchItemId: candidate.id,
              designerId,
              isCurrent: true,
            },
            select: { id: true },
          });

          // Notify the Designer. Committed atomically with the assignment and status change.
          await tx.notification.create({
            data: {
              workspaceId,
              userId: designerId,
              type: NOTIFICATION_TYPE_DESIGN_ASSIGNED,
              title: "Design Assigned",
              message: "You have been assigned a new design.",
              researchItemId: candidate.id,
            },
          });

          return "assigned" as const;
        },
        { maxWait: 10000, timeout: 15000 }
      );

      if (outcome === "assigned") {
        assignedCount++;
      } else {
        // "no-designer": no eligible Designers remain; stop processing further items.
        stopLoop = true;
      }
    } catch (error) {
      if (error instanceof BacklogItemSkippedError) {
        // Concurrent status claim: transaction rolled back, nothing committed. Next item.
        continue;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // Partial unique index conflict: concurrent duplicate assignment, full rollback. Next item.
        continue;
      }

      throw error;
    }
  }

  // Re-count after processing to report the accurate remaining backlog.
  const remainingUnassignedCount = await prisma.researchItem.count({
    where: {
      workspaceId,
      status: ResearchStatus.RESEARCHED,
      referenceImageUrl: { not: null },
      designAssignments: { none: { isCurrent: true } },
    },
  });

  return { assignedCount, remainingUnassignedCount, designerCount };
};
