import { z } from "zod";

export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: "Invalid ISO datetime" })
  .transform((value) => new Date(value));

export const validateDateRange = (
  value: { dateFrom?: Date; dateTo?: Date },
  context: z.RefinementCtx
): void => {
  if ((value.dateFrom === undefined) !== (value.dateTo === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "dateFrom and dateTo must be supplied together",
      path: value.dateFrom === undefined ? ["dateFrom"] : ["dateTo"],
    });
    return;
  }

  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "dateFrom must be before or equal to dateTo",
      path: ["dateFrom"],
    });
  }
};
