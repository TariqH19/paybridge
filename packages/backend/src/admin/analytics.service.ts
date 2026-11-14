import type { Db } from "mongodb";
import {
  AdminAnalyticsResponseSchema,
  type AdminAnalyticsQuery,
  type AdminAnalyticsResponse,
} from "./analytics.schema.js";

type CurrencySummary = {
  _id: string;
  totalOrders: number;
  paidOrders: number;
  pendingOrders: number;
  failedOrders: number;
  grossRevenue: number;
  refundedOrders: number;
};

type OrderDay = { _id: { date: string; status: string }; count: number };
type RevenueDay = { _id: { date: string; currency: string }; amount: number };
type StatusCount = { _id: string; count: number };
type ProductRevenue = {
  _id: { productId: string; name: string; currency: string };
  amount: number;
  quantity: number;
};
type RefundSummary = { _id: string; amount: number; refundedOrders: number };
type RefundDay = {
  _id: { date: string; currency: string; status: string };
  amount: number;
  count: number;
};

export async function buildAdminAnalytics(
  database: Db,
  filters: AdminAnalyticsQuery,
): Promise<AdminAnalyticsResponse> {
  const orderMatch: Record<string, unknown> = {};
  const orderDateRange = buildDateRange(filters.from, filters.to);
  if (orderDateRange) orderMatch.createdAt = orderDateRange;
  if (filters.currency) orderMatch.currency = filters.currency;
  if (filters.orderStatus) orderMatch.status = filters.orderStatus;

  const [orderAnalytics, refundAnalytics, orderCurrencies, refundCurrencies] =
    await Promise.all([
      database
        .collection("orders")
        .aggregate<{
          summary: CurrencySummary[];
          revenueOverTime: RevenueDay[];
          ordersOverTime: OrderDay[];
          ordersByStatus: StatusCount[];
          revenueByProduct: ProductRevenue[];
        }>([
          { $match: orderMatch },
          {
            $facet: {
              summary: [
                {
                  $group: {
                    _id: "$currency",
                    totalOrders: { $sum: 1 },
                    paidOrders: {
                      $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] },
                    },
                    pendingOrders: {
                      $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
                    },
                    failedOrders: {
                      $sum: { $cond: [{ $eq: ["$status", "payment_failed"] }, 1, 0] },
                    },
                    grossRevenue: {
                      $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$total", 0] },
                    },
                    refundedOrders: {
                      $sum: {
                        $cond: [
                          {
                            $and: [
                              { $eq: ["$status", "paid"] },
                              { $gt: [{ $ifNull: ["$refundedAmount", 0] }, 0] },
                            ],
                          },
                          1,
                          0,
                        ],
                      },
                    },
                  },
                },
                { $sort: { _id: 1 } },
              ],
              revenueOverTime: [
                { $match: { status: "paid" } },
                {
                  $group: {
                    _id: {
                      date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } },
                      currency: "$currency",
                    },
                    amount: { $sum: "$total" },
                  },
                },
                { $sort: { "_id.date": 1, "_id.currency": 1 } },
              ],
              ordersOverTime: [
                {
                  $group: {
                    _id: {
                      date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } },
                      status: "$status",
                    },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { "_id.date": 1, "_id.status": 1 } },
              ],
              ordersByStatus: [
                { $group: { _id: "$status", count: { $sum: 1 } } },
                { $sort: { _id: 1 } },
              ],
              revenueByProduct: [
                { $match: { status: "paid" } },
                { $unwind: "$items" },
                {
                  $group: {
                    _id: {
                      productId: "$items.productId",
                      name: "$items.name",
                      currency: "$currency",
                    },
                    amount: { $sum: "$items.lineTotal" },
                    quantity: { $sum: "$items.quantity" },
                  },
                },
                { $sort: { amount: -1, "_id.currency": 1 } },
                { $limit: 50 },
              ],
            },
          },
        ])
        .next(),
      buildRefundAnalytics(database, filters),
      database.collection("orders").distinct("currency"),
      database.collection("refunds").distinct("currency"),
    ]);

  const summary = orderAnalytics?.summary ?? [];
  const totalOrders = sumSafe(summary.map(({ totalOrders }) => totalOrders), "total orders");
  const paidOrders = sumSafe(summary.map(({ paidOrders }) => paidOrders), "paid orders");
  const pendingOrders = sumSafe(summary.map(({ pendingOrders }) => pendingOrders), "pending orders");
  const failedOrders = sumSafe(summary.map(({ failedOrders }) => failedOrders), "failed orders");
  const grossRevenue = summary
    .map(({ _id: currency, grossRevenue: amount }) => ({
      currency,
      amount: safeInteger(amount, `gross revenue for ${currency}`),
    }))
    .filter(({ amount }) => amount > 0);
  const totalRefunded = refundAnalytics.summary.map(({ _id: currency, amount }) => ({
    currency,
    amount: safeInteger(amount, `refund total for ${currency}`),
  }));
  const netAmounts = new Map<string, number>();
  for (const { currency, amount } of grossRevenue) netAmounts.set(currency, amount);
  for (const { currency, amount } of totalRefunded) {
    netAmounts.set(currency, (netAmounts.get(currency) ?? 0) - amount);
  }
  const netRevenue = [...netAmounts]
    .map(([currency, amount]) => ({
      currency,
      amount: safeInteger(amount, `net revenue for ${currency}`),
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
  const averageOrderValue = summary
    .filter(({ paidOrders: count }) => count > 0)
    .map(({ _id: currency, grossRevenue: amount, paidOrders: count }) => ({
      currency,
      amount: safeInteger(Math.round(amount / count), `average order value for ${currency}`),
    }));
  const refundedOrders = sumSafe(
    refundAnalytics.summary.map((entry) => entry.refundedOrders),
    "refunded orders",
  );
  const terminalOrders = safeInteger(paidOrders + failedOrders, "terminal orders");
  const allCurrencies = [...new Set([...orderCurrencies, ...refundCurrencies])].sort();
  const response: AdminAnalyticsResponse = {
    filters: {
      from: filters.from ?? null,
      to: filters.to ?? null,
      currency: filters.currency ?? null,
      orderStatus: filters.orderStatus ?? null,
      refundStatus: filters.refundStatus ?? null,
    },
    currencies: allCurrencies,
    metrics: {
      totalOrders,
      paidOrders,
      pendingOrders,
      failedOrders,
      grossRevenue,
      totalRefunded,
      netRevenue,
      averageOrderValue,
      refundRate:
        paidOrders > 0
          ? {
              percentage: (refundedOrders / paidOrders) * 100,
              refundedOrders,
              paidOrders,
            }
          : null,
      paymentSuccessRate:
        terminalOrders > 0
          ? {
              percentage: (paidOrders / terminalOrders) * 100,
              paidOrders,
              terminalOrders,
            }
          : null,
    },
    charts: {
      revenueOverTime: (orderAnalytics?.revenueOverTime ?? []).map(({ _id, amount }) => ({
        date: _id.date,
        currency: _id.currency,
        amount: safeInteger(amount, `revenue on ${_id.date}`),
      })),
      ordersOverTime: (orderAnalytics?.ordersOverTime ?? []).map(({ _id, count }) => ({
        date: _id.date,
        status: _id.status as AdminAnalyticsResponse["charts"]["ordersOverTime"][number]["status"],
        count: safeInteger(count, `orders on ${_id.date}`),
      })),
      ordersByStatus: (orderAnalytics?.ordersByStatus ?? []).map(({ _id, count }) => ({
        status: _id as AdminAnalyticsResponse["charts"]["ordersByStatus"][number]["status"],
        count: safeInteger(count, `orders with status ${_id}`),
      })),
      revenueByProduct: (orderAnalytics?.revenueByProduct ?? []).map(
        ({ _id, amount, quantity }) => ({
          productId: _id.productId,
          name: _id.name,
          currency: _id.currency,
          amount: safeInteger(amount, `product revenue for ${_id.name}`),
          quantity: safeInteger(quantity, `product quantity for ${_id.name}`),
        }),
      ),
      refundsOverTime: refundAnalytics.series.map(({ _id, amount, count }) => ({
        date: _id.date,
        currency: _id.currency,
        status: _id.status as AdminAnalyticsResponse["charts"]["refundsOverTime"][number]["status"],
        amount: safeInteger(amount, `refunds on ${_id.date}`),
        count: safeInteger(count, `refund count on ${_id.date}`),
      })),
    },
  };
  return AdminAnalyticsResponseSchema.parse(response);
}

async function buildRefundAnalytics(
  database: Db,
  filters: AdminAnalyticsQuery,
): Promise<{ summary: RefundSummary[]; series: RefundDay[] }> {
  const refundMatch: Record<string, unknown> = {};
  const dateRange = buildDateRange(filters.from, filters.to);
  if (dateRange) refundMatch.createdAt = dateRange;
  if (filters.currency) refundMatch.currency = filters.currency;
  const orderMatch: Record<string, unknown> = {};
  if (filters.orderStatus) orderMatch["order.status"] = filters.orderStatus;
  if (dateRange) orderMatch["order.createdAt"] = dateRange;
  if (filters.currency) orderMatch["order.currency"] = filters.currency;

  const result = await database
    .collection("refunds")
    .aggregate<{
      summary: RefundSummary[];
      series: RefundDay[];
    }>([
      { $match: refundMatch },
      {
        $lookup: {
          from: "orders",
          localField: "orderId",
          foreignField: "_id",
          as: "order",
        },
      },
      { $unwind: "$order" },
      { $match: orderMatch },
      {
        $facet: {
          summary: [
            { $match: { status: "succeeded" } },
            {
              $group: {
                _id: { currency: "$currency", orderId: "$orderId" },
                amount: { $sum: "$amount" },
              },
            },
            {
              $group: {
                _id: "$_id.currency",
                amount: { $sum: "$amount" },
                refundedOrders: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
          series: [
            ...(filters.refundStatus ? [{ $match: { status: filters.refundStatus } }] : []),
            {
              $group: {
                _id: {
                  date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "UTC" } },
                  currency: "$currency",
                  status: "$status",
                },
                amount: { $sum: "$amount" },
                count: { $sum: 1 },
              },
            },
            { $sort: { "_id.date": 1, "_id.currency": 1, "_id.status": 1 } },
          ],
        },
      },
    ])
    .next();
  return { summary: result?.summary ?? [], series: result?.series ?? [] };
}

function buildDateRange(
  from: string | undefined,
  to: string | undefined,
): { $gte?: Date; $lt?: Date } | undefined {
  if (!from && !to) return undefined;
  const range: { $gte?: Date; $lt?: Date } = {};
  if (from) range.$gte = new Date(`${from}T00:00:00.000Z`);
  if (to) {
    const end = new Date(`${to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    range.$lt = end;
  }
  return range;
}

function sumSafe(values: number[], label: string): number {
  return safeInteger(values.reduce((sum, value) => sum + value, 0), label);
}

function safeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Analytics aggregation returned an unsafe integer for ${label}.`);
  }
  return value;
}
