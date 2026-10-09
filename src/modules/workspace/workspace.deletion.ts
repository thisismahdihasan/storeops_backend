export const WORKSPACE_DELETION_GRACE_PERIOD_MS = 72 * 60 * 60 * 1000;

export const getPermanentDeletionAt = (
  deletionScheduledAt: Date | null
): Date | null =>
  deletionScheduledAt
    ? new Date(deletionScheduledAt.getTime() + WORKSPACE_DELETION_GRACE_PERIOD_MS)
    : null;
