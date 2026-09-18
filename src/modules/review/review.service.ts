import { Prisma, ResearchStatus, WorkspaceRole } from "@prisma/client";
import prisma from "../../lib/prisma.js";
import { ApiError } from "../../shared/ApiError.js";
import {
  ApproveReviewResult,
  CreateAnnotationReplyResult,
  CreateReviewAnnotationResult,
  DeleteAnnotationReplyResult,
  DeleteReviewAnnotationResult,
  ReviewDetailResult,
  ReviewQueueResult,
  NOTIFICATION_TYPE_DESIGN_APPROVED,
  NOTIFICATION_TYPE_DESIGN_CORRECTION_REQUESTED,
  RequestCorrectionResult,
  UpdateAnnotationReplyResult,
  UpdateReviewAnnotationResult,
} from "./review.type.js";
import {
  CreateAnnotationReplyBodyInput,
  CreateReviewAnnotationBodyInput,
  GetReviewQueueQueryInput,
  UpdateAnnotationReplyBodyInput,
  UpdateReviewAnnotationBodyInput,
} from "./review.validation.js";

const safeReviewUserSelect = {
  id: true,
  name: true,
  email: true,
  profileImageUrl: true,
} as const;

const safeReviewHistorySelect = Prisma.validator<Prisma.ReviewSubmissionSelect>()({
  id: true,
  roundNumber: true,
  imageUrl: true,
  imageDeletedAt: true,
  note: true,
  submittedAt: true,
  approvedAt: true,
  approvedById: true,
  annotations: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      x: true,
      y: true,
      comment: true,
      resolved: true,
      createdAt: true,
      updatedAt: true,
      createdBy: {
        select: {
          id: true,
          name: true,
        },
      },
      replies: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          message: true,
          createdAt: true,
          updatedAt: true,
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  },
});

// Retrieves current review submissions awaiting an ADMIN decision in one workspace.
export const getReviewQueue = async (
  workspaceId: string,
  query: GetReviewQueueQueryInput
): Promise<ReviewQueueResult> => {
  const where = {
    workspaceId,
    status: ResearchStatus.DESIGN_REVIEW,
  };
  const skip = (query.page - 1) * query.limit;

  const [researchItems, total] = await prisma.$transaction([
    prisma.researchItem.findMany({
      where,
      select: {
        id: true,
        etsyListingId: true,
        title: true,
        status: true,
        originalUrl: true,
        normalizedUrl: true,
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
          },
        },
        designAssignments: {
          where: { isCurrent: true },
          take: 1,
          select: {
            designer: {
              select: safeReviewUserSelect,
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip,
      take: query.limit,
    }),
    prisma.researchItem.count({ where }),
  ]);

  const items = researchItems.flatMap((researchItem) => {
    const review = researchItem.reviewSubmissions[0];
    if (!review) {
      return [];
    }

    return [{
      review: {
        ...review,
        imageUrl: review.imageDeletedAt === null ? review.imageUrl : null,
      },
      researchItem: {
        id: researchItem.id,
        etsyListingId: researchItem.etsyListingId,
        title: researchItem.title,
        status: researchItem.status,
        originalUrl: researchItem.originalUrl,
        normalizedUrl: researchItem.normalizedUrl,
      },
      designer: researchItem.designAssignments[0]?.designer ?? null,
    }];
  });

  return {
    items,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    },
  };
};

// Returns one accessible review and every review round for the same research item.
export const getReviewDetail = async (
  workspaceId: string,
  reviewId: string,
  userId: string,
  userRoles: readonly WorkspaceRole[]
): Promise<ReviewDetailResult> => {
  const selectedReviewRecord = await prisma.reviewSubmission.findFirst({
    where: {
      id: reviewId,
      researchItem: { workspaceId },
    },
    select: {
      id: true,
      researchItem: {
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
          createdBy: {
            select: safeReviewUserSelect,
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
                select: safeReviewUserSelect,
              },
            },
          },
          reviewSubmissions: {
            orderBy: [{ roundNumber: "asc" }, { id: "asc" }],
            select: safeReviewHistorySelect,
          },
        },
      },
    },
  });

  if (!selectedReviewRecord) {
    throw new ApiError(404, "Review submission not found");
  }

  const currentAssignment =
    selectedReviewRecord.researchItem.designAssignments[0] ?? null;
  const isAdmin = userRoles.includes(WorkspaceRole.ADMIN);

  if (!isAdmin && currentAssignment?.designerId !== userId) {
    throw new ApiError(403, "You are not assigned to this research item");
  }

  const reviews = selectedReviewRecord.researchItem.reviewSubmissions.map(
    (review) => ({
      ...review,
      imageUrl: review.imageDeletedAt === null ? review.imageUrl : null,
    })
  );
  const selectedReview = reviews.find((review) => review.id === reviewId);
  const latestReview = reviews[reviews.length - 1];

  if (!selectedReview || !latestReview) {
    throw new ApiError(404, "Review submission not found");
  }

  return {
    researchItem: {
      id: selectedReviewRecord.researchItem.id,
      etsyListingId: selectedReviewRecord.researchItem.etsyListingId,
      originalUrl: selectedReviewRecord.researchItem.originalUrl,
      normalizedUrl: selectedReviewRecord.researchItem.normalizedUrl,
      title: selectedReviewRecord.researchItem.title,
      referenceImageUrl: selectedReviewRecord.researchItem.referenceImageUrl,
      status: selectedReviewRecord.researchItem.status,
      createdAt: selectedReviewRecord.researchItem.createdAt,
      updatedAt: selectedReviewRecord.researchItem.updatedAt,
      createdBy: selectedReviewRecord.researchItem.createdBy,
    },
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
    selectedReview,
    latestReviewId: latestReview.id,
    reviews,
  };
};

export const ALLOWED_ANNOTATION_REPLY_STATUSES = [
  ResearchStatus.DESIGN_REVIEW,
  ResearchStatus.CORRECTION_NEEDED,
  ResearchStatus.DESIGN_IN_PROGRESS,
] as const;

export type AllowedAnnotationReplyStatus =
  (typeof ALLOWED_ANNOTATION_REPLY_STATUSES)[number];

const assertLatestReviewRound = async (
  tx: Prisma.TransactionClient,
  researchItemId: string,
  reviewSubmissionId: string,
  message: string
): Promise<void> => {
  const latestReview = await tx.reviewSubmission.findFirst({
    where: { researchItemId },
    orderBy: { roundNumber: "desc" },
    select: { id: true },
  });

  if (!latestReview || latestReview.id !== reviewSubmissionId) {
    throw new ApiError(409, message);
  }
};

const assertAnnotationWorkflowGate = async (
  tx: Prisma.TransactionClient,
  workspaceId: string,
  researchItemId: string,
  reviewSubmissionId: string
): Promise<void> => {
  const item = await tx.researchItem.findFirst({
    where: { id: researchItemId, workspaceId },
    select: { status: true },
  });

  if (!item || item.status !== ResearchStatus.DESIGN_REVIEW) {
    throw new ApiError(409, "Annotation is no longer editable on this review");
  }

  await assertLatestReviewRound(
    tx,
    researchItemId,
    reviewSubmissionId,
    "Annotations can only be changed on the current review round"
  );
};

const assertAnnotationEditor = async (
  tx: Prisma.TransactionClient,
  workspaceId: string,
  userId: string
): Promise<void> => {
  const member = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { roles: true },
  });

  if (!member || !member.roles.includes(WorkspaceRole.ADMIN)) {
    throw new ApiError(403, "Insufficient workspace permissions");
  }
};

const assertReplyWorkflowGate = async (
  tx: Prisma.TransactionClient,
  workspaceId: string,
  researchItemId: string,
  reviewSubmissionId: string
): Promise<void> => {
  const item = await tx.researchItem.findFirst({
    where: { id: researchItemId, workspaceId },
    select: { status: true },
  });

  if (
    !item ||
    !(ALLOWED_ANNOTATION_REPLY_STATUSES as readonly ResearchStatus[]).includes(
      item.status
    )
  ) {
    throw new ApiError(409, "Reply is no longer editable on this review");
  }

  await assertLatestReviewRound(
    tx,
    researchItemId,
    reviewSubmissionId,
    "Replies can only be changed on the current review round"
  );
};

const assertReplyParticipant = async (
  tx: Prisma.TransactionClient,
  workspaceId: string,
  researchItemId: string,
  userId: string
): Promise<void> => {
  const member = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { roles: true },
  });

  if (!member) {
    throw new ApiError(403, "You do not have access to this workspace");
  }

  const isAdmin = member.roles.includes(WorkspaceRole.ADMIN);
  const isDesigner = member.roles.includes(WorkspaceRole.DESIGNER);
  if (!isAdmin && !isDesigner) {
    throw new ApiError(403, "Insufficient workspace permissions");
  }

  if (!isAdmin) {
    const currentAssignment = await tx.designAssignment.findFirst({
      where: { researchItemId, isCurrent: true },
      select: { designerId: true },
    });

    if (!currentAssignment || currentAssignment.designerId !== userId) {
      throw new ApiError(403, "You are not assigned to this research item");
    }
  }
};

// Atomically creates an annotation on the current active review round for an admin.
export const createReviewAnnotation = async (
  workspaceId: string,
  reviewId: string,
  adminId: string,
  input: CreateReviewAnnotationBodyInput
): Promise<CreateReviewAnnotationResult> => {
  return await prisma.$transaction(
    async (tx) => {
      // 1. Scoped lookup: verify review belongs to a research item in this workspace
      const targetReview = await tx.reviewSubmission.findFirst({
        where: {
          id: reviewId,
          researchItem: {
            workspaceId,
          },
        },
        select: {
          id: true,
          researchItemId: true,
          roundNumber: true,
          researchItem: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      if (!targetReview) {
        throw new ApiError(404, "Review submission not found");
      }

      // 2. Status validation: annotations are only permitted when item is in DESIGN_REVIEW
      if (targetReview.researchItem.status !== ResearchStatus.DESIGN_REVIEW) {
        throw new ApiError(
          409,
          `Cannot add annotations when research item status is ${targetReview.researchItem.status}`
        );
      }

      // 3. Current review round rule: must be the latest review round for this research item
      const latestReview = await tx.reviewSubmission.findFirst({
        where: {
          researchItemId: targetReview.researchItemId,
        },
        orderBy: {
          roundNumber: "desc",
        },
        select: {
          id: true,
          roundNumber: true,
        },
      });

      if (!latestReview || latestReview.id !== targetReview.id) {
        throw new ApiError(
          409,
          "Annotations can only be added to the current review round"
        );
      }

      // 4. Create ReviewAnnotation record with default resolved = false
      const trimmedComment = input.comment.trim();
      if (!trimmedComment) {
        throw new ApiError(400, "comment cannot be empty");
      }

      const annotation = await tx.reviewAnnotation.create({
        data: {
          reviewSubmissionId: targetReview.id,
          createdById: adminId,
          x: input.x,
          y: input.y,
          comment: trimmedComment,
        },
        select: {
          id: true,
          reviewSubmissionId: true,
          x: true,
          y: true,
          comment: true,
          resolved: true,
          createdAt: true,
          updatedAt: true,
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return {
        annotation,
      };
    },
    {
      maxWait: 10000,
      timeout: 15000,
    }
  );
};

// Atomically creates a threaded reply on an annotation belonging to the current active review round.
export const createAnnotationReply = async (
  workspaceId: string,
  annotationId: string,
  userId: string,
  input: CreateAnnotationReplyBodyInput
): Promise<CreateAnnotationReplyResult> => {
  return await prisma.$transaction(
    async (tx) => {
      // 1. Scoped lookup: verify annotation belongs to a research item in this workspace
      const targetAnnotation = await tx.reviewAnnotation.findFirst({
        where: {
          id: annotationId,
          reviewSubmission: {
            researchItem: {
              workspaceId,
            },
          },
        },
        select: {
          id: true,
          reviewSubmissionId: true,
          reviewSubmission: {
            select: {
              id: true,
              researchItemId: true,
              roundNumber: true,
              researchItem: {
                select: {
                  id: true,
                  status: true,
                },
              },
            },
          },
        },
      });

      if (!targetAnnotation) {
        throw new ApiError(404, "Annotation not found");
      }

      // 2. Authoritative role check: workspace membership
      const member = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId,
          },
        },
        select: {
          roles: true,
        },
      });

      if (!member) {
        throw new ApiError(403, "You do not have access to this workspace");
      }

      const isAdmin = member.roles.includes(WorkspaceRole.ADMIN);
      const isDesigner = member.roles.includes(WorkspaceRole.DESIGNER);

      if (!isAdmin && !isDesigner) {
        throw new ApiError(403, "Insufficient workspace permissions");
      }

      // 3. Designer assignment verification (ADMIN is independently sufficient)
      if (!isAdmin) {
        const currentAssignment = await tx.designAssignment.findFirst({
          where: {
            researchItemId: targetAnnotation.reviewSubmission.researchItemId,
            isCurrent: true,
          },
          select: {
            id: true,
            designerId: true,
          },
        });

        if (!currentAssignment || currentAssignment.designerId !== userId) {
          throw new ApiError(403, "You are not assigned to this research item");
        }
      }

      // 4. Workflow status validation: allowed on DESIGN_REVIEW, CORRECTION_NEEDED, DESIGN_IN_PROGRESS
      const itemStatus = targetAnnotation.reviewSubmission.researchItem.status;
      if (
        !(ALLOWED_ANNOTATION_REPLY_STATUSES as readonly ResearchStatus[]).includes(
          itemStatus
        )
      ) {
        throw new ApiError(
          409,
          `Cannot add replies when research item status is ${itemStatus}`
        );
      }

      // 5. Current review round rule: must belong to the latest review round for this research item
      const latestReview = await tx.reviewSubmission.findFirst({
        where: {
          researchItemId: targetAnnotation.reviewSubmission.researchItemId,
        },
        orderBy: {
          roundNumber: "desc",
        },
        select: {
          id: true,
          roundNumber: true,
        },
      });

      if (
        !latestReview ||
        latestReview.id !== targetAnnotation.reviewSubmissionId
      ) {
        throw new ApiError(
          409,
          "Replies can only be added to annotations on the current review round"
        );
      }

      // 6. Create AnnotationReply record
      const trimmedMessage = input.message.trim();
      if (!trimmedMessage) {
        throw new ApiError(400, "message cannot be empty");
      }

      const reply = await tx.annotationReply.create({
        data: {
          annotationId: targetAnnotation.id,
          createdById: userId,
          message: trimmedMessage,
        },
        select: {
          id: true,
          annotationId: true,
          message: true,
          createdAt: true,
          updatedAt: true,
          createdBy: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      return {
        reply,
      };
    },
    {
      maxWait: 10000,
      timeout: 15000,
    }
  );
};

// Updates an owned annotation only while its latest review remains actionable.
export const updateReviewAnnotation = async (
  workspaceId: string,
  annotationId: string,
  userId: string,
  input: UpdateReviewAnnotationBodyInput
): Promise<UpdateReviewAnnotationResult> => {
  return await prisma.$transaction(
    async (tx) => {
      const annotation = await tx.reviewAnnotation.findFirst({
        where: {
          id: annotationId,
          reviewSubmission: { researchItem: { workspaceId } },
        },
        select: {
          id: true,
          createdById: true,
          reviewSubmissionId: true,
          reviewSubmission: { select: { researchItemId: true } },
        },
      });

      if (!annotation) throw new ApiError(404, "Annotation not found");
      if (annotation.createdById !== userId) {
        throw new ApiError(403, "You can only edit your own annotation");
      }
      await assertAnnotationEditor(tx, workspaceId, userId);

      await assertAnnotationWorkflowGate(
        tx,
        workspaceId,
        annotation.reviewSubmission.researchItemId,
        annotation.reviewSubmissionId
      );

      const updated = await tx.reviewAnnotation.updateMany({
        where: {
          id: annotation.id,
          createdById: userId,
          reviewSubmission: {
            id: annotation.reviewSubmissionId,
            researchItem: { workspaceId, status: ResearchStatus.DESIGN_REVIEW },
          },
        },
        data: { comment: input.comment.trim(), updatedAt: new Date() },
      });

      if (updated.count !== 1) {
        await assertAnnotationWorkflowGate(
          tx,
          workspaceId,
          annotation.reviewSubmission.researchItemId,
          annotation.reviewSubmissionId
        );
        throw new ApiError(409, "Annotation is no longer editable on this review");
      }

      await assertAnnotationWorkflowGate(
        tx,
        workspaceId,
        annotation.reviewSubmission.researchItemId,
        annotation.reviewSubmissionId
      );

      const updatedAnnotation = await tx.reviewAnnotation.findUnique({
        where: { id: annotation.id },
        select: {
          id: true,
          reviewSubmissionId: true,
          x: true,
          y: true,
          comment: true,
          resolved: true,
          createdAt: true,
          updatedAt: true,
          createdBy: { select: { id: true, name: true } },
        },
      });

      if (!updatedAnnotation) throw new ApiError(404, "Annotation not found");
      return { annotation: updatedAnnotation };
    },
    { maxWait: 10000, timeout: 15000 }
  );
};

// Hard-deletes an owned annotation only when no reply can be lost.
export const deleteReviewAnnotation = async (
  workspaceId: string,
  annotationId: string,
  userId: string
): Promise<DeleteReviewAnnotationResult> => {
  return await prisma.$transaction(
    async (tx) => {
      const annotation = await tx.reviewAnnotation.findFirst({
        where: {
          id: annotationId,
          reviewSubmission: { researchItem: { workspaceId } },
        },
        select: {
          id: true,
          createdById: true,
          reviewSubmissionId: true,
          reviewSubmission: { select: { researchItemId: true } },
        },
      });

      if (!annotation) throw new ApiError(404, "Annotation not found");
      if (annotation.createdById !== userId) {
        throw new ApiError(403, "You can only delete your own annotation");
      }
      await assertAnnotationEditor(tx, workspaceId, userId);

      await assertAnnotationWorkflowGate(
        tx,
        workspaceId,
        annotation.reviewSubmission.researchItemId,
        annotation.reviewSubmissionId
      );

      const replyCount = await tx.annotationReply.count({
        where: { annotationId: annotation.id },
      });
      if (replyCount > 0) {
        throw new ApiError(409, "Annotations with replies cannot be deleted");
      }

      const deleted = await tx.reviewAnnotation.deleteMany({
        where: {
          id: annotation.id,
          createdById: userId,
          replies: { none: {} },
          reviewSubmission: {
            id: annotation.reviewSubmissionId,
            researchItem: { workspaceId, status: ResearchStatus.DESIGN_REVIEW },
          },
        },
      });

      if (deleted.count !== 1) {
        const remainingReplies = await tx.annotationReply.count({
          where: { annotationId: annotation.id },
        });
        if (remainingReplies > 0) {
          throw new ApiError(409, "Annotations with replies cannot be deleted");
        }
        await assertAnnotationWorkflowGate(
          tx,
          workspaceId,
          annotation.reviewSubmission.researchItemId,
          annotation.reviewSubmissionId
        );
        throw new ApiError(404, "Annotation not found");
      }

      await assertAnnotationWorkflowGate(
        tx,
        workspaceId,
        annotation.reviewSubmission.researchItemId,
        annotation.reviewSubmissionId
      );

      return { annotationId: annotation.id };
    },
    { maxWait: 10000, timeout: 15000 }
  );
};

// Updates an owned reply while the current review conversation remains open.
export const updateAnnotationReply = async (
  workspaceId: string,
  annotationId: string,
  replyId: string,
  userId: string,
  input: UpdateAnnotationReplyBodyInput
): Promise<UpdateAnnotationReplyResult> => {
  return await prisma.$transaction(
    async (tx) => {
      const reply = await tx.annotationReply.findFirst({
        where: {
          id: replyId,
          annotationId,
          annotation: { reviewSubmission: { researchItem: { workspaceId } } },
        },
        select: {
          id: true,
          createdById: true,
          annotationId: true,
          annotation: {
            select: {
              reviewSubmissionId: true,
              reviewSubmission: { select: { researchItemId: true } },
            },
          },
        },
      });

      if (!reply) throw new ApiError(404, "Annotation reply not found");
      if (reply.createdById !== userId) {
        throw new ApiError(403, "You can only edit your own reply");
      }

      const researchItemId = reply.annotation.reviewSubmission.researchItemId;
      const reviewSubmissionId = reply.annotation.reviewSubmissionId;
      await assertReplyParticipant(tx, workspaceId, researchItemId, userId);
      await assertReplyWorkflowGate(
        tx,
        workspaceId,
        researchItemId,
        reviewSubmissionId
      );

      const updated = await tx.annotationReply.updateMany({
        where: {
          id: reply.id,
          annotationId,
          createdById: userId,
          annotation: {
            reviewSubmission: {
              id: reviewSubmissionId,
              researchItem: {
                workspaceId,
                status: { in: [...ALLOWED_ANNOTATION_REPLY_STATUSES] },
              },
            },
          },
        },
        data: { message: input.message.trim(), updatedAt: new Date() },
      });

      if (updated.count !== 1) {
        await assertReplyWorkflowGate(
          tx,
          workspaceId,
          researchItemId,
          reviewSubmissionId
        );
        throw new ApiError(409, "Reply is no longer editable on this review");
      }

      await assertReplyWorkflowGate(
        tx,
        workspaceId,
        researchItemId,
        reviewSubmissionId
      );

      const updatedReply = await tx.annotationReply.findUnique({
        where: { id: reply.id },
        select: {
          id: true,
          annotationId: true,
          message: true,
          createdAt: true,
          updatedAt: true,
          createdBy: { select: { id: true, name: true } },
        },
      });

      if (!updatedReply) throw new ApiError(404, "Annotation reply not found");
      return { reply: updatedReply };
    },
    { maxWait: 10000, timeout: 15000 }
  );
};

// Hard-deletes only the caller's reply from an open current review conversation.
export const deleteAnnotationReply = async (
  workspaceId: string,
  annotationId: string,
  replyId: string,
  userId: string
): Promise<DeleteAnnotationReplyResult> => {
  return await prisma.$transaction(
    async (tx) => {
      const reply = await tx.annotationReply.findFirst({
        where: {
          id: replyId,
          annotationId,
          annotation: { reviewSubmission: { researchItem: { workspaceId } } },
        },
        select: {
          id: true,
          createdById: true,
          annotationId: true,
          annotation: {
            select: {
              reviewSubmissionId: true,
              reviewSubmission: { select: { researchItemId: true } },
            },
          },
        },
      });

      if (!reply) throw new ApiError(404, "Annotation reply not found");
      if (reply.createdById !== userId) {
        throw new ApiError(403, "You can only delete your own reply");
      }

      const researchItemId = reply.annotation.reviewSubmission.researchItemId;
      const reviewSubmissionId = reply.annotation.reviewSubmissionId;
      await assertReplyParticipant(tx, workspaceId, researchItemId, userId);
      await assertReplyWorkflowGate(
        tx,
        workspaceId,
        researchItemId,
        reviewSubmissionId
      );

      const deleted = await tx.annotationReply.deleteMany({
        where: {
          id: reply.id,
          annotationId,
          createdById: userId,
          annotation: {
            reviewSubmission: {
              id: reviewSubmissionId,
              researchItem: {
                workspaceId,
                status: { in: [...ALLOWED_ANNOTATION_REPLY_STATUSES] },
              },
            },
          },
        },
      });

      if (deleted.count !== 1) {
        await assertReplyWorkflowGate(
          tx,
          workspaceId,
          researchItemId,
          reviewSubmissionId
        );
        throw new ApiError(404, "Annotation reply not found");
      }

      await assertReplyWorkflowGate(
        tx,
        workspaceId,
        researchItemId,
        reviewSubmissionId
      );

      return { replyId: reply.id };
    },
    { maxWait: 10000, timeout: 15000 }
  );
};

// Atomically transitions an item from DESIGN_REVIEW to CORRECTION_NEEDED and notifies the current assigned designer.
export const requestReviewCorrection = async (
  workspaceId: string,
  reviewId: string
): Promise<RequestCorrectionResult> => {
  return await prisma.$transaction(
    async (tx) => {
      // 1. Scoped lookup: verify review belongs to a research item in this workspace
      const targetReview = await tx.reviewSubmission.findFirst({
        where: {
          id: reviewId,
          researchItem: {
            workspaceId,
          },
        },
        select: {
          id: true,
          researchItemId: true,
          roundNumber: true,
          researchItem: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      if (!targetReview) {
        throw new ApiError(404, "Review submission not found");
      }

      // 2. Status validation: correction can only be requested from DESIGN_REVIEW
      if (targetReview.researchItem.status !== ResearchStatus.DESIGN_REVIEW) {
        throw new ApiError(
          409,
          `Cannot request correction when research item status is ${targetReview.researchItem.status}`
        );
      }

      // 3. Current review round rule: must be the latest review round for this research item
      const latestReview = await tx.reviewSubmission.findFirst({
        where: {
          researchItemId: targetReview.researchItemId,
        },
        orderBy: {
          roundNumber: "desc",
        },
        select: {
          id: true,
          roundNumber: true,
        },
      });

      if (!latestReview || latestReview.id !== targetReview.id) {
        throw new ApiError(
          409,
          "Correction can only be requested for the current review round"
        );
      }

      // 4. Current designer recipient lookup: must have an active current assignment
      const currentAssignment = await tx.designAssignment.findFirst({
        where: {
          researchItemId: targetReview.researchItemId,
          isCurrent: true,
        },
        select: {
          id: true,
          designerId: true,
        },
      });

      if (!currentAssignment) {
        throw new ApiError(
          500,
          "No active design assignment found for this research item"
        );
      }

      // 5. Designer role invariant: assigned designer must be an active DESIGNER member of the workspace
      const designerMember = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: currentAssignment.designerId,
          },
        },
        select: {
          roles: true,
        },
      });

      if (
        !designerMember ||
        !designerMember.roles.includes(WorkspaceRole.DESIGNER)
      ) {
        throw new ApiError(
          500,
          "Assigned designer is no longer a designer in this workspace"
        );
      }

      // 6. Correction feedback requirement: the current round must have at least one actionable annotation.
      const annotationCount = await tx.reviewAnnotation.count({
        where: {
          reviewSubmissionId: targetReview.id,
        },
      });

      if (annotationCount === 0) {
        throw new ApiError(
          409,
          "Add at least one correction note before requesting changes.",
          true,
          "",
          { code: "CORRECTION_FEEDBACK_REQUIRED" }
        );
      }

      // 7. Concurrency gate: conditional atomic status transition on ResearchItem
      const updatedItemResult = await tx.researchItem.updateMany({
        where: {
          id: targetReview.researchItemId,
          workspaceId,
          status: ResearchStatus.DESIGN_REVIEW,
        },
        data: {
          status: ResearchStatus.CORRECTION_NEEDED,
          updatedAt: new Date(),
        },
      });

      if (updatedItemResult.count !== 1) {
        throw new ApiError(
          409,
          "Research item is not in DESIGN_REVIEW status or has already been updated"
        );
      }

      // 8. Post-gate race verification: re-verify latest review round and assignment ownership
      const recheckLatest = await tx.reviewSubmission.findFirst({
        where: {
          researchItemId: targetReview.researchItemId,
        },
        orderBy: {
          roundNumber: "desc",
        },
        select: {
          id: true,
        },
      });

      if (!recheckLatest || recheckLatest.id !== targetReview.id) {
        throw new ApiError(
          409,
          "Correction can only be requested for the current review round"
        );
      }

      const stillCurrentAssignment = await tx.designAssignment.findFirst({
        where: {
          id: currentAssignment.id,
          researchItemId: targetReview.researchItemId,
          isCurrent: true,
        },
        select: {
          designerId: true,
        },
      });

      if (
        !stillCurrentAssignment ||
        stillCurrentAssignment.designerId !== currentAssignment.designerId
      ) {
        throw new ApiError(
          500,
          "Design assignment changed concurrently during correction request"
        );
      }

      // 8. Create exactly one notification for the current assigned designer
      await tx.notification.create({
        data: {
          workspaceId,
          userId: currentAssignment.designerId,
          type: NOTIFICATION_TYPE_DESIGN_CORRECTION_REQUESTED,
          title: "Correction Requested",
          message: "Your design needs corrections.",
          researchItemId: targetReview.researchItemId,
        },
      });

      return {
        researchItem: {
          id: targetReview.researchItemId,
          status: ResearchStatus.CORRECTION_NEEDED,
        },
      };
    },
    {
      maxWait: 10000,
      timeout: 15000,
    }
  );
};

// Atomically transitions an item from DESIGN_REVIEW to DESIGN_APPROVED, records approval metadata on the latest ReviewSubmission, and notifies the current assigned designer.
export const approveReviewSubmission = async (
  workspaceId: string,
  reviewId: string,
  adminId: string
): Promise<ApproveReviewResult> => {
  return await prisma.$transaction(
    async (tx) => {
      // 1. Scoped lookup: verify review belongs to a research item in this workspace
      const targetReview = await tx.reviewSubmission.findFirst({
        where: {
          id: reviewId,
          researchItem: {
            workspaceId,
          },
        },
        select: {
          id: true,
          researchItemId: true,
          roundNumber: true,
          approvedAt: true,
          researchItem: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      });

      if (!targetReview) {
        throw new ApiError(404, "Review submission not found");
      }

      // 2. Status validation: approval can only occur from DESIGN_REVIEW
      if (targetReview.researchItem.status !== ResearchStatus.DESIGN_REVIEW) {
        throw new ApiError(
          409,
          `Cannot approve review when research item status is ${targetReview.researchItem.status}`
        );
      }

      // 3. Current review round rule: must be the latest review round for this research item
      const latestReview = await tx.reviewSubmission.findFirst({
        where: {
          researchItemId: targetReview.researchItemId,
        },
        orderBy: {
          roundNumber: "desc",
        },
        select: {
          id: true,
          roundNumber: true,
        },
      });

      if (!latestReview || latestReview.id !== targetReview.id) {
        throw new ApiError(
          409,
          "Only the current review round can be approved"
        );
      }

      // 4. Current designer recipient lookup: must have an active current assignment
      const currentAssignment = await tx.designAssignment.findFirst({
        where: {
          researchItemId: targetReview.researchItemId,
          isCurrent: true,
        },
        select: {
          id: true,
          designerId: true,
        },
      });

      if (!currentAssignment) {
        throw new ApiError(
          500,
          "No active design assignment found for this research item"
        );
      }

      // 5. Designer role invariant: assigned designer must be an active DESIGNER member of the workspace
      const designerMember = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: currentAssignment.designerId,
          },
        },
        select: {
          roles: true,
        },
      });

      if (
        !designerMember ||
        !designerMember.roles.includes(WorkspaceRole.DESIGNER)
      ) {
        throw new ApiError(
          500,
          "Assigned designer is no longer a designer in this workspace"
        );
      }

      const now = new Date();

      // 6. Concurrency gate: conditional atomic status transition on ResearchItem
      const updatedItemResult = await tx.researchItem.updateMany({
        where: {
          id: targetReview.researchItemId,
          workspaceId,
          status: ResearchStatus.DESIGN_REVIEW,
        },
        data: {
          status: ResearchStatus.DESIGN_APPROVED,
          updatedAt: now,
        },
      });

      if (updatedItemResult.count !== 1) {
        throw new ApiError(
          409,
          "Research item is not in DESIGN_REVIEW status or has already been updated"
        );
      }

      // 7. Post-gate race verification: re-verify latest review round, assignment ownership, and designer role
      const recheckLatest = await tx.reviewSubmission.findFirst({
        where: {
          researchItemId: targetReview.researchItemId,
        },
        orderBy: {
          roundNumber: "desc",
        },
        select: {
          id: true,
        },
      });

      if (!recheckLatest || recheckLatest.id !== targetReview.id) {
        throw new ApiError(
          409,
          "Only the current review round can be approved"
        );
      }

      const stillCurrentAssignment = await tx.designAssignment.findFirst({
        where: {
          id: currentAssignment.id,
          researchItemId: targetReview.researchItemId,
          isCurrent: true,
        },
        select: {
          designerId: true,
        },
      });

      if (
        !stillCurrentAssignment ||
        stillCurrentAssignment.designerId !== currentAssignment.designerId
      ) {
        throw new ApiError(
          500,
          "Design assignment changed concurrently during review approval"
        );
      }

      const stillDesignerMember = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId: stillCurrentAssignment.designerId,
          },
        },
        select: {
          roles: true,
        },
      });

      if (
        !stillDesignerMember ||
        !stillDesignerMember.roles.includes(WorkspaceRole.DESIGNER)
      ) {
        throw new ApiError(
          500,
          "Assigned designer is no longer a designer in this workspace"
        );
      }

      // 8. Update approval metadata conditionally on the target latest ReviewSubmission
      const updatedReviewResult = await tx.reviewSubmission.updateMany({
        where: {
          id: targetReview.id,
          researchItemId: targetReview.researchItemId,
          approvedAt: null,
        },
        data: {
          approvedAt: now,
          approvedById: adminId,
        },
      });

      if (updatedReviewResult.count !== 1) {
        throw new ApiError(
          409,
          "Review submission has already been approved or modified"
        );
      }

      // 9. Create exactly one notification for the current assigned designer
      await tx.notification.create({
        data: {
          workspaceId,
          userId: currentAssignment.designerId,
          type: NOTIFICATION_TYPE_DESIGN_APPROVED,
          title: "Design Approved",
          message: "Design approved. Upload final files.",
          researchItemId: targetReview.researchItemId,
        },
      });

      return {
        researchItem: {
          id: targetReview.researchItemId,
          status: ResearchStatus.DESIGN_APPROVED,
        },
        reviewSubmission: {
          id: targetReview.id,
          roundNumber: targetReview.roundNumber,
          approvedAt: now,
          approvedById: adminId,
        },
      };
    },
    {
      maxWait: 10000,
      timeout: 15000,
    }
  );
};
