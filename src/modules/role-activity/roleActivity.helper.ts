export const buildDateRangeFilter = (
  dateFrom?: Date,
  dateTo?: Date
): { gte: Date; lte: Date } | undefined =>
  dateFrom && dateTo ? { gte: dateFrom, lte: dateTo } : undefined;
