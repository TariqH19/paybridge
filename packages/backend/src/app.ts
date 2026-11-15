import cors from "cors";
import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import swaggerUi from "swagger-ui-express";
import { config } from "./config.js";
import { connectToDatabase, getDatabase } from "./db.js";
import { adminRouter } from "./admin/admin.router.js";
import { ordersRouter } from "./orders/orders.router.js";
import { productsRouter } from "./products/products.router.js";
import { checkoutRouter } from "./stripe/checkout.router.js";
import { stripeWebhookRouter } from "./stripe/stripe-webhook.router.js";
import { openApiDocument } from "./openapi.js";

export const app = express();

app.use((_request, response, next) => {
  response.setHeader("x-request-id", randomUUID());
  next();
});
app.use(cors({ origin: config.FRONTEND_URL }));
const swaggerOptions = {
  supportedSubmitMethods: ["get", "head"],
  persistAuthorization: false,
  validatorUrl: null,
};
app.use(
  "/",
  ...swaggerUi.serveFiles(undefined, {
    swaggerUrl: "/api/openapi.json",
    swaggerOptions,
  }),
);
app.get(
  "/",
  swaggerUi.setup(undefined, {
    swaggerUrl: "/api/openapi.json",
    swaggerOptions,
    customSiteTitle: "PayBridge API Documentation",
  }),
);
app.get("/api/openapi.json", (_request, response) => {
  response.json(openApiDocument);
});
app.use(
  "/api/webhooks/stripe",
  express.raw({ type: "application/json" }),
  stripeWebhookRouter,
);
app.use(express.json());

app.use(async (_request, _response, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (error) {
    next(error);
  }
});

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
  const candidateStatus =
    typeof error === "object" && error !== null
      ? "status" in error
        ? error.status
        : "statusCode" in error
          ? error.statusCode
          : undefined
      : undefined;
  const status =
    typeof candidateStatus === "number" && candidateStatus >= 400 && candidateStatus < 500
      ? candidateStatus
      : 500;

  if (status >= 500) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "http_request_failed",
        requestId: response.getHeader("x-request-id"),
        method: _request.method,
        path: _request.path,
        status,
        errorName: error instanceof Error ? error.name : "UnknownError",
      }),
    );
  }

  const message =
    status === 400
      ? "Invalid request body"
      : status === 413
        ? "Request body is too large"
        : status === 415
          ? "Unsupported media type"
          : status < 500
            ? "Invalid request"
            : "Internal server error";
  response.status(status).json({ error: message });
};

app.use(errorHandler);

export default app;
