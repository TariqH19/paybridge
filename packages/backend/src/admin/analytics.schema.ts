import { z } from "zod";

const AnalyticsOrderStatusSchema = z.enum([
  "pending",
  "paid",
  "payment_failed",
  "cancelled",
]);
const AnalyticsRefundStatusSchema = z.enum(["pending", "succeeded", "failed"]);
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);
const IntegerSchema = z.number().int().max(Number.MAX_SAFE_INTEGER);
const MoneySchema = IntegerSchema.nonnegative();
const AnalyticsQuerySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    currency: CurrencySchema.optional(),
    orderStatus: AnalyticsOrderStatusSchema.optional(),
    refundStatus: AnalyticsRefundStatusSchema.optional(),
  })
  .strict()
  .refine(({ from, to }) => !from || !to || from <= to, {
    message: "The start date must not be after the end date.",
    path: ["from"],
  });

const CurrencyAmountSchema = z
  .object({ currency: CurrencySchema, amount: IntegerSchema })
  .strict();
const NonnegativeCurrencyAmountSchema = z
  .object({ currency: CurrencySchema, amount: MoneySchema })
  .strict();

export const AdminAnalyticsQuerySchema = AnalyticsQuerySchema;

export const AdminAnalyticsResponseSchema = z
  .object({
    filters: z
      .object({
        from: z.iso.date().nullable(),
        to: z.iso.date().nullable(),
        currency: CurrencySchema.nullable(),
        orderStatus: AnalyticsOrderStatusSchema.nullable(),
        refundStatus: AnalyticsRefundStatusSchema.nullable(),
      })
      .strict(),
    currencies: z.array(CurrencySchema),
    metrics: z
      .object({
        totalOrders: MoneySchema,
        paidOrders: MoneySchema,
        pendingOrders: MoneySchema,
        failedOrders: MoneySchema,
        grossRevenue: z.array(NonnegativeCurrencyAmountSchema),
        totalRefunded: z.array(NonnegativeCurrencyAmountSchema),
        netRevenue: z.array(CurrencyAmountSchema),
        averageOrderValue: z.array(NonnegativeCurrencyAmountSchema),
        refundRate: z
          .object({
            percentage: z.number().finite().min(0).max(100),
            refundedOrders: MoneySchema,
            paidOrders: MoneySchema,
          })
          .strict()
          .nullable(),
        paymentSuccessRate: z
          .object({
            percentage: z.number().finite().min(0).max(100),
            paidOrders: MoneySchema,
            terminalOrders: MoneySchema,
          })
          .strict()
          .nullable(),
      })
      .strict(),
    charts: z
      .object({
        revenueOverTime: z
          .array(
            z
              .object({ date: z.iso.date(), currency: CurrencySchema, amount: MoneySchema })
              .strict(),
          ),
        ordersOverTime: z
          .array(
            z
              .object({
                date: z.iso.date(),
                status: AnalyticsOrderStatusSchema,
                count: MoneySchema,
              })
              .strict(),
          ),
        ordersByStatus: z
          .array(
            z
              .object({ status: AnalyticsOrderStatusSchema, count: MoneySchema })
              .strict(),
          ),
        revenueByProduct: z
          .array(
            z
              .object({
                productId: z.string().regex(/^[a-f\d]{24}$/i),
                name: z.string().min(1),
                currency: CurrencySchema,
                amount: MoneySchema,
                quantity: MoneySchema,
              })
              .strict(),
          ),
        refundsOverTime: z
          .array(
            z
              .object({
                date: z.iso.date(),
                currency: CurrencySchema,
                status: AnalyticsRefundStatusSchema,
                amount: MoneySchema,
                count: MoneySchema,
              })
              .strict(),
          ),
      })
      .strict(),
  })
  .strict();

export type AdminAnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;
export type AdminAnalyticsResponse = z.infer<typeof AdminAnalyticsResponseSchema>;
