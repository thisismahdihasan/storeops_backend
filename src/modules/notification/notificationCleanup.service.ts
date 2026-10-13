import prisma from "../../lib/prisma.js";

export const READ_NOTIFICATION_RETENTION_DAYS = 10;
export const UNREAD_NOTIFICATION_RETENTION_DAYS = 15;

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;

// Removes transient inbox entries after their state-specific retention window.
export const cleanupExpiredNotifications = async (now: Date = new Date()) => {
  const readCutoff = new Date(
    now.getTime() - READ_NOTIFICATION_RETENTION_DAYS * DAY_IN_MILLISECONDS,
  );
  const unreadCutoff = new Date(
    now.getTime() - UNREAD_NOTIFICATION_RETENTION_DAYS * DAY_IN_MILLISECONDS,
  );

  const result = await prisma.notification.deleteMany({
    where: {
      OR: [
        { isRead: true, createdAt: { lt: readCutoff } },
        { isRead: false, createdAt: { lt: unreadCutoff } },
      ],
    },
  });

  return {
    deletedCount: result.count,
    readRetentionDays: READ_NOTIFICATION_RETENTION_DAYS,
    unreadRetentionDays: UNREAD_NOTIFICATION_RETENTION_DAYS,
    readCutoff: readCutoff.toISOString(),
    unreadCutoff: unreadCutoff.toISOString(),
  };
};
