import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { config } from "./config.js";
import { getDatabase } from "./db.js";
import { adminRouter } from "./admin/admin.router.js";
import { ordersRouter } from "./orders/orders.router.js";
import { productsRouter } from "./products/products.router.js";
import { checkoutRouter } from "./stripe/checkout.router.js";
import { stripeWebhookRouter } from "./stripe/stripe-webhook.router.js";

export const app = express();

app.use(cors({ origin: config.FRONTEND_URL }));
app.use(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhookRouter,
);
app.use(express.json());

app.get("/api/health", async (_request, response, next) => {
  try {
    await getDatabase().command({ ping: 1 });
    response.json({ status: "ok" });
  } catch (error) {
    next(error);
  }
});

app.use("/api/products", productsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/orders", checkoutRouter);
app.use("/api/orders", ordersRouter);

app.use((_request, response) => {
  response.status(404).json({ error: "Route not found" });
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500
      ? error.status
      : 500;
  console.error("Request failed", error instanceof Error ? error.name : "Unknown error");
  response
    .status(status)
    .json({ error: status === 400 ? "Invalid request body" : "Internal server error" });
};

app.use(errorHandler);
