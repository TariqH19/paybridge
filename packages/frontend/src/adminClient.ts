import { z } from "zod";

import { apiUrl, getApiErrorMessage, requestJson } from "./api";

export type AdminOrderStatus = "pending" | "paid" | "payment_failed" | "cancelled";
export type AdminPaymentStatus = AdminOrderStatus | "not_started";

export type AdminOrderSummary = {
  id: string;
  reference: string;
  customer: { name: string; email: string };
  createdAt: string;
  total: number;
  currency: string;
  status: AdminOrderStatus;
  paymentStatus: AdminPaymentStatus;
  refundStatus: "none" | "pending" | "partially_refunded" | "fully_refunded" | "failed";
  refundedAmount: number;
};

export type AdminPayment = {
  id: string;
  orderReference: string;
  stripeCheckoutSessionId: string;
  amount: number;
  currency: string;
  status: AdminOrderStatus;
  provider: "stripe";
  refundStatus: "none" | "pending" | "partially_refunded" | "fully_refunded" | "failed";
  refundedAmount: number;
  pendingRefundAmount: number;
  remainingRefundableAmount: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminRefund = {
  id: string;
  stripeRefundId: string | null;
  paymentId: string;
  orderReference: string;
  amount: number;
  currency: string;
  status: AdminRefundStatus;
  reason: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
};
export type AdminRefundStatus = "pending" | "succeeded" | "failed";
export type AdminRefundReason = "duplicate" | "fraudulent" | "requested_by_customer";

const AnalyticsMoneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const SignedAnalyticsMoneySchema = z.number().int().max(Number.MAX_SAFE_INTEGER);
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);
const AnalyticsOrderStatusSchema = z.enum([
  "pending",
  "paid",
  "payment_failed",
  "cancelled",
]);
const AnalyticsRefundStatusSchema = z.enum(["pending", "succeeded", "failed"]);
const AnalyticsCurrencyAmountSchema = z
  .object({ currency: CurrencySchema, amount: AnalyticsMoneySchema })
  .strict();

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
        totalOrders: AnalyticsMoneySchema,
        paidOrders: AnalyticsMoneySchema,
        pendingOrders: AnalyticsMoneySchema,
        failedOrders: AnalyticsMoneySchema,
        grossRevenue: z.array(AnalyticsCurrencyAmountSchema),
        totalRefunded: z.array(AnalyticsCurrencyAmountSchema),
        netRevenue: z
          .array(z.object({ currency: CurrencySchema, amount: SignedAnalyticsMoneySchema }).strict()),
        averageOrderValue: z.array(AnalyticsCurrencyAmountSchema),
        refundRate: z
          .object({
            percentage: z.number().finite().min(0).max(100),
            refundedOrders: AnalyticsMoneySchema,
            paidOrders: AnalyticsMoneySchema,
          })
          .strict()
          .nullable(),
        paymentSuccessRate: z
          .object({
            percentage: z.number().finite().min(0).max(100),
            paidOrders: AnalyticsMoneySchema,
            terminalOrders: AnalyticsMoneySchema,
          })
          .strict()
          .nullable(),
      })
      .strict(),
    charts: z
      .object({
        revenueOverTime: z
          .array(z.object({ date: z.iso.date(), currency: CurrencySchema, amount: AnalyticsMoneySchema }).strict()),
        ordersOverTime: z
          .array(z.object({ date: z.iso.date(), status: AnalyticsOrderStatusSchema, count: AnalyticsMoneySchema }).strict()),
        ordersByStatus: z
          .array(z.object({ status: AnalyticsOrderStatusSchema, count: AnalyticsMoneySchema }).strict()),
        revenueByProduct: z
          .array(
            z
              .object({
                productId: z.string().regex(/^[a-f\d]{24}$/i),
                name: z.string().min(1),
                currency: CurrencySchema,
                amount: AnalyticsMoneySchema,
                quantity: AnalyticsMoneySchema,
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
                amount: AnalyticsMoneySchema,
                count: AnalyticsMoneySchema,
              })
              .strict(),
          ),
      })
      .strict(),
  })
  .strict();
export type AdminAnalytics = z.infer<typeof AdminAnalyticsResponseSchema>;
export type AdminAnalyticsFilters = {
  from: string;
  to: string;
  currency: string;
  orderStatus: string;
  refundStatus: string;
};

export type AdminWebhookEvent = {
  eventId: string;
  type: string;
  status: string;
  createdAt: string;
  processedAt: string | null;
};

const MoneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const AdminOrderSummaryResponseSchema = z
  .object({
    id: z.string().regex(/^[a-f\d]{24}$/i),
    reference: z.string().min(1),
    customer: z.object({ name: z.string().min(1), email: z.email() }).strict(),
    createdAt: z.iso.datetime(),
    total: MoneySchema,
    currency: CurrencySchema,
    status: z.enum(["pending", "paid", "payment_failed", "cancelled"]),
    paymentStatus: z.enum(["pending", "paid", "payment_failed", "cancelled", "not_started"]),
    refundStatus: z.enum(["none", "pending", "partially_refunded", "fully_refunded", "failed"]),
    refundedAmount: MoneySchema,
  })
  .strict();

export const AdminOverviewResponseSchema = z
  .object({
    totalOrders: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    pendingOrders: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    paidRevenue: z
      .array(z.object({ currency: CurrencySchema, amount: MoneySchema }).strict())
      .refine((amounts) => new Set(amounts.map(({ currency }) => currency)).size === amounts.length),
    failedPayments: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    paymentSuccessRate: z
      .object({
        percentage: z.number().finite().min(0).max(100),
        paid: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        terminal: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      })
      .strict()
      .nullable(),
    recentOrders: z.array(AdminOrderSummaryResponseSchema),
  })
  .strict();
export type AdminOverview = z.infer<typeof AdminOverviewResponseSchema>;

export type AdminOrderDetail = {
  order: AdminOrderSummary;
  customer: { name: string; email: string };
  items: Array<{
    productId: string;
    name: string;
    imageUrl: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
    currency: string;
  }>;
  subtotal: number;
  total: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  payments: AdminPayment[];
  refunds: AdminRefund[];
};

export type PendingOrderInvestigation =
  | { found: false; reference: string }
  | {
      found: true;
      order: {
        id: string;
        reference: string;
        status: AdminOrderStatus;
        total: number;
        currency: string;
        items: Array<{ name: string; quantity: number; unitPrice: number }>;
        hasCheckoutSessionId: boolean;
        createdAt: string;
        updatedAt: string;
      };
      payments: AdminPayment[];
      recentCheckoutEvents: AdminWebhookEvent[];
      eventOrderCorrelationAvailable: false;
    };

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

async function request<T>(
  path: string,
  token?: string,
  init?: RequestInit,
): Promise<T> {
  const { response, body } = await requestJson(`${apiUrl}/admin${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    throw new AdminApiError(
      getApiErrorMessage(body, `Admin request failed (${response.status}).`),
      response.status,
    );
  }

  return body as T;
}

export function createAdminSession(username: string, password: string) {
  return request<{ token: string; expiresAt: string }>("/session", undefined, {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function getAdminOverview(token: string) {
  return request<unknown>("/overview", token).then((result) => {
    const parsed = AdminOverviewResponseSchema.safeParse(result);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Admin overview response validation failed: ${details}`);
    }
    return parsed.data;
  });
}

export function getAdminAnalytics(token: string, filters: AdminAnalyticsFilters) {
  const query = new URLSearchParams();
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  if (filters.currency) query.set("currency", filters.currency);
  if (filters.orderStatus) query.set("orderStatus", filters.orderStatus);
  if (filters.refundStatus) query.set("refundStatus", filters.refundStatus);
  return request<unknown>(`/analytics?${query.toString()}`, token).then((result) => {
    const parsed = AdminAnalyticsResponseSchema.safeParse(result);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ");
      throw new Error(`Admin analytics response validation failed: ${details}`);
    }
    return parsed.data;
  });
}

export function getAdminOrders(
  token: string,
  filters: { search: string; status: string; sort: string },
) {
  const query = new URLSearchParams();
  if (filters.search) query.set("search", filters.search);
  if (filters.status) query.set("status", filters.status);
  query.set("sort", filters.sort);
  return request<{ total: number; limit: number; orders: AdminOrderSummary[] }>(
    `/orders?${query.toString()}`,
    token,
  );
}

export function getAdminOrder(token: string, id: string) {
  return request<AdminOrderDetail>(`/orders/${encodeURIComponent(id)}`, token);
}

export function createAdminRefund(
  token: string,
  orderId: string,
  input: {
    paymentId: string;
    amount: number;
    reason?: AdminRefundReason;
    idempotencyKey: string;
  },
) {
  return request<{
    refund: AdminRefund;
    payment: AdminPayment;
    remainingRefundableAmount: number;
  }>(`/orders/${encodeURIComponent(orderId)}/refunds`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getAdminPayments(token: string) {
  return request<AdminPayment[]>("/payments", token);
}

export function getAdminWebhookEvents(token: string) {
  return request<AdminWebhookEvent[]>("/webhook-events", token);
}

export function getAdminWebhookEvent(token: string, eventId: string) {
  return request<AdminWebhookEvent>(`/webhook-events/${encodeURIComponent(eventId)}`, token);
}

export function getPendingOrderInvestigation(token: string) {
  return request<PendingOrderInvestigation>("/investigations/pending-order", token);
}
