const errorResponse = {
  description: "Request failed.",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
      example: { error: "Request could not be completed." },
    },
  },
};

const adminSecurity = [{ AdminBearer: [] }];

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "PayBridge API",
    version: "1.0.0",
    description:
      "Developer reference for the PayBridge single-merchant commerce API. Stripe payment functionality is restricted to test mode. This UI permits Try it out for GET and HEAD operations only; state-changing operations are documented but cannot be submitted from Swagger UI.",
  },
  servers: [{ url: "/", description: "Current backend origin" }],
  tags: [
    { name: "Health", description: "Backend and MongoDB availability." },
    { name: "Products", description: "Public active product catalogue." },
    { name: "Orders", description: "Customer order creation and Stripe Checkout." },
    { name: "Stripe webhooks", description: "Signed Stripe event delivery." },
    { name: "Admin authentication", description: "Admin session creation." },
    { name: "Admin overview", description: "Protected operational dashboard overview." },
    { name: "Admin orders", description: "Protected order operations and refunds." },
    { name: "Admin payments", description: "Protected payment-attempt records." },
    { name: "Admin webhooks", description: "Protected processed webhook metadata." },
    { name: "Admin analytics", description: "Protected MongoDB-backed analytics." },
    { name: "Admin investigation", description: "Protected read-only pending-order evidence." },
  ],
  paths: {
    "/api/health": {
      get: {
        tags: ["Health"],
        summary: "Check API and database connectivity",
        description:
          "Pings the explicitly selected paybridge MongoDB database. Read-only apart from the database ping.",
        operationId: "getHealth",
        "x-side-effects": false,
        responses: {
          "200": {
            description: "The API can reach MongoDB.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Health" },
                example: { status: "ok" },
              },
            },
          },
          "500": errorResponse,
        },
      },
    },
    "/api/products": {
      get: {
        tags: ["Products"],
        summary: "List active products",
        description: "Returns active catalogue products sorted by category and name.",
        operationId: "listProducts",
        "x-side-effects": false,
        responses: {
          "200": {
            description: "Active product records. An empty catalogue returns an empty array.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Product" },
                },
              },
            },
          },
          "500": errorResponse,
        },
      },
    },
    "/api/products/{id}": {
      get: {
        tags: ["Products"],
        summary: "Get one active product",
        operationId: "getProduct",
        "x-side-effects": false,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "24-character hexadecimal MongoDB ObjectId.",
            schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
          },
        ],
        responses: {
          "200": {
            description: "The active product.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Product" } },
            },
          },
          "400": errorResponse,
          "404": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/orders": {
      post: {
        tags: ["Orders"],
        summary: "Create a pending order",
        description:
          "State-changing. The server reloads active products and prices, checks stock and shared currency, calculates integer minor-unit totals, and stores customer and item snapshots. Prices and totals are not accepted from the client.",
        operationId: "createOrder",
        "x-side-effects": true,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateOrderRequest" },
              example: {
                customer: { name: "Example Customer", email: "customer@example.com" },
                items: [{ productId: "64f000000000000000000001", quantity: 1 }],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Pending order created.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Order" } },
            },
          },
          "400": errorResponse,
          "409": errorResponse,
          "422": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/orders/{id}/checkout": {
      post: {
        tags: ["Orders"],
        summary: "Create or reuse Stripe Checkout",
        description:
          "State-changing and external-provider operation. Creates or reuses a Checkout Session for a pending order and returns its hosted URL. Stripe access is test-mode only. Payment status is confirmed by a verified webhook, not by the browser return.",
        operationId: "createCheckoutSession",
        "x-side-effects": true,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "24-character hexadecimal MongoDB order ObjectId.",
            schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
          },
        ],
        responses: {
          "200": {
            description: "Hosted Stripe Checkout URL.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CheckoutResponse" },
                example: { checkoutUrl: "https://checkout.stripe.com/c/pay/..." },
              },
            },
          },
          "400": errorResponse,
          "404": errorResponse,
          "409": errorResponse,
          "502": errorResponse,
          "503": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/webhooks/stripe": {
      post: {
        tags: ["Stripe webhooks"],
        summary: "Receive a signed Stripe event",
        description:
          "State-changing server-to-server endpoint. Requires the exact raw JSON body and Stripe-Signature header. The signature is verified before processing; supported payment/refund state and event metadata are persisted transactionally. Stripe retries non-2xx processing failures. This operation is disabled in Swagger Try it out.",
        operationId: "receiveStripeWebhook",
        "x-side-effects": true,
        parameters: [
          {
            name: "Stripe-Signature",
            in: "header",
            required: true,
            description: "Stripe-generated signature for this exact raw request body.",
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          description: "Stripe event JSON sent as raw bytes; do not re-serialize before signature verification.",
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: {
          "200": {
            description: "Event accepted or previously processed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/WebhookAcknowledgement" },
                example: { received: true, duplicate: false },
              },
            },
          },
          "400": errorResponse,
          "503": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/admin/session": {
      post: {
        tags: ["Admin authentication"],
        summary: "Create an admin bearer session",
        description:
          "Exchanges the backend-configured admin credentials for an eight-hour HMAC-signed bearer token. No demo credentials are provided. State-changing/authentication operations cannot be submitted from Swagger UI.",
        operationId: "createAdminSession",
        "x-side-effects": true,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AdminLoginRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Signed token and expiry time. Keep the token private.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/AdminSession" } },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "503": errorResponse,
        },
      },
    },
    "/api/admin/overview": {
      get: {
        tags: ["Admin overview"],
        summary: "Get dashboard overview",
        description:
          "Protected read. Revenue is grouped by currency. Payment success rate uses terminal payment records (paid and payment_failed), and recent orders are limited to six.",
        operationId: "getAdminOverview",
        security: adminSecurity,
        "x-side-effects": false,
        responses: {
          "200": {
            description: "Order/payment metrics and recent orders.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/AdminOverview" } },
            },
          },
          "401": errorResponse,
          "503": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/admin/analytics": {
      get: {
        tags: ["Admin analytics"],
        summary: "Get analytics",
        description:
          "Protected read. Aggregates order and refund data in MongoDB. Monetary results are grouped by currency. The refundStatus filter narrows the refunds time-series; settled refund summary metrics count succeeded refunds.",
        operationId: "getAdminAnalytics",
        security: adminSecurity,
        "x-side-effects": false,
        parameters: [
          {
            name: "from",
            in: "query",
            required: false,
            description: "Inclusive UTC calendar date (YYYY-MM-DD).",
            schema: { type: "string", format: "date" },
          },
          {
            name: "to",
            in: "query",
            required: false,
            description: "Inclusive UTC calendar date (YYYY-MM-DD).",
            schema: { type: "string", format: "date" },
          },
          {
            name: "currency",
            in: "query",
            required: false,
            description: "Three uppercase letters.",
            schema: { type: "string", pattern: "^[A-Z]{3}$" },
          },
          {
            name: "orderStatus",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["pending", "paid", "payment_failed", "cancelled"],
            },
          },
          {
            name: "refundStatus",
            in: "query",
            required: false,
            description: "Filters the refunds time-series; succeeded-refund summary metrics remain settled-only.",
            schema: { type: "string", enum: ["pending", "succeeded", "failed"] },
          },
        ],
        responses: {
          "200": {
            description: "Validated metrics, currency groups, and time-series data.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AdminAnalytics" },
              },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "503": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/admin/orders": {
      get: {
        tags: ["Admin orders"],
        summary: "Search and list orders",
        description:
          "Protected read. Returns up to 100 orders with the total number matching the filters; there is no pagination parameter.",
        operationId: "listAdminOrders",
        security: adminSecurity,
        "x-side-effects": false,
        parameters: [
          {
            name: "search",
            in: "query",
            required: false,
            description: "Case-insensitive search across reference, customer name, and email; maximum 120 characters.",
            schema: { type: "string", maxLength: 120 },
          },
          {
            name: "status",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["pending", "paid", "payment_failed", "cancelled"],
            },
          },
          {
            name: "sort",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["newest", "oldest"], default: "newest" },
          },
        ],
        responses: {
          "200": {
            description: "Matching total, limit, and order summaries.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/AdminOrderList" } },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "503": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/admin/orders/{id}": {
      get: {
        tags: ["Admin orders"],
        summary: "Get order details",
        description: "Protected read of the order snapshot, associated payment summaries, and refund records.",
        operationId: "getAdminOrder",
        security: adminSecurity,
        "x-side-effects": false,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "24-character hexadecimal MongoDB order ObjectId.",
            schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
          },
        ],
        responses: {
          "200": {
            description: "Order, customer, items, payment and refund data.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/AdminOrderDetail" } },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "404": errorResponse,
          "503": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/admin/orders/{id}/refunds": {
      post: {
        tags: ["Admin orders"],
        summary: "Request a full or partial refund",
        description:
          "Protected, state-changing Stripe test-mode operation. Requires a paid order and its associated paid payment. The backend reserves the requested minor-unit amount transactionally, records the refund, and calls Stripe with an idempotency key. A request is not treated as succeeded until Stripe outcome reconciliation.",
        operationId: "createAdminRefund",
        security: adminSecurity,
        "x-side-effects": true,
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "24-character hexadecimal MongoDB order ObjectId.",
            schema: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RefundRequest" },
              example: {
                paymentId: "64f000000000000000000002",
                amount: 500,
                reason: "requested_by_customer",
                idempotencyKey: "5ebd2da8-8ee8-40dd-a3fb-c501d4135980",
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Refund record, payment summary, and remaining refundable amount.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/RefundResponse" } },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "404": errorResponse,
          "409": errorResponse,
          "502": errorResponse,
          "503": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/admin/payments": {
      get: {
        tags: ["Admin payments"],
        summary: "List recent payment records",
        description:
          "Protected read of the latest 100 payment records. Stripe secret/payment-intent credentials are not returned.",
        operationId: "listAdminPayments",
        security: adminSecurity,
        "x-side-effects": false,
        responses: {
          "200": {
            description: "Payment summary records.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/AdminPayment" },
                },
              },
            },
          },
          "401": errorResponse,
          "503": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/admin/webhook-events": {
      get: {
        tags: ["Admin webhooks"],
        summary: "List processed webhook metadata",
        description:
          "Protected read of the latest 100 processed Stripe webhook event metadata records. Raw event payloads are not stored or returned.",
        operationId: "listAdminWebhookEvents",
        security: adminSecurity,
        "x-side-effects": false,
        responses: {
          "200": {
            description: "Processed event metadata.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/WebhookEvent" },
                },
              },
            },
          },
          "401": errorResponse,
          "503": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/admin/webhook-events/{eventId}": {
      get: {
        tags: ["Admin webhooks"],
        summary: "Get processed webhook metadata",
        operationId: "getAdminWebhookEvent",
        security: adminSecurity,
        "x-side-effects": false,
        parameters: [
          {
            name: "eventId",
            in: "path",
            required: true,
            description: "Stripe event ID.",
            schema: { type: "string", pattern: "^evt_[A-Za-z0-9]+$" },
          },
        ],
        responses: {
          "200": {
            description: "Processed event metadata; no raw payload.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/WebhookEvent" } },
            },
          },
          "400": errorResponse,
          "401": errorResponse,
          "404": errorResponse,
          "503": errorResponse,
          "500": errorResponse,
        },
      },
    },
    "/api/admin/investigations/pending-order": {
      get: {
        tags: ["Admin investigation"],
        summary: "Inspect configured pending-order evidence",
        description:
          "Protected read-only evidence view for the order reference configured in the backend. The response explicitly indicates that stored webhook metadata cannot be correlated to an order.",
        operationId: "getPendingOrderInvestigation",
        security: adminSecurity,
        "x-side-effects": false,
        responses: {
          "200": {
            description: "Found/not-found result with order, payment, and recent Checkout event metadata when available.",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/PendingOrderInvestigation" } },
            },
          },
          "401": errorResponse,
          "503": errorResponse,
          "500": errorResponse,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      AdminBearer: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "PayBridge HMAC-signed admin session",
        description:
          "Required for protected admin routes. Obtain a session through the application's configured admin login flow. Swagger UI disables POST execution, so it cannot issue login or other state-changing requests.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string", example: "Request could not be completed." },
          details: {
            type: "array",
            items: {
              type: "object",
              properties: {
                field: { type: "string" },
                message: { type: "string" },
              },
            },
          },
        },
      },
      Health: {
        type: "object",
        required: ["status"],
        properties: { status: { type: "string", enum: ["ok"] } },
      },
      Product: {
        type: "object",
        required: [
          "id",
          "name",
          "description",
          "price",
          "currency",
          "category",
          "imageUrl",
          "stock",
          "active",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
          name: { type: "string", minLength: 1, maxLength: 120 },
          description: { type: "string", minLength: 1, maxLength: 1000 },
          price: { type: "integer", minimum: 0, description: "Integer minor currency units." },
          currency: { $ref: "#/components/schemas/Currency" },
          category: { type: "string", minLength: 1, maxLength: 60 },
          imageUrl: { type: "string", format: "uri" },
          stock: { type: "integer", minimum: 0 },
          active: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      Currency: {
        type: "string",
        pattern: "^[A-Z]{3}$",
        description: "Three-letter uppercase currency code.",
      },
      Customer: {
        type: "object",
        required: ["name", "email"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          email: { type: "string", format: "email", maxLength: 254 },
        },
      },
      CreateOrderRequest: {
        type: "object",
        additionalProperties: false,
        required: ["customer", "items"],
        properties: {
          customer: { $ref: "#/components/schemas/Customer" },
          items: {
            type: "array",
            minItems: 1,
            maxItems: 50,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["productId", "quantity"],
              properties: {
                productId: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
                quantity: { type: "integer", minimum: 1, maximum: 99 },
              },
            },
          },
        },
        description:
          "Strict request shape. Duplicate product IDs are rejected; all requested items must be active, available, and share one currency.",
      },
      OrderItem: {
        type: "object",
        required: ["productId", "name", "imageUrl", "unitPrice", "quantity", "lineTotal", "currency"],
        properties: {
          productId: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
          name: { type: "string" },
          imageUrl: { type: "string", format: "uri" },
          unitPrice: { type: "integer", minimum: 0 },
          quantity: { type: "integer", minimum: 1 },
          lineTotal: { type: "integer", minimum: 0 },
          currency: { $ref: "#/components/schemas/Currency" },
        },
      },
      Order: {
        type: "object",
        required: [
          "id",
          "reference",
          "customer",
          "items",
          "subtotal",
          "total",
          "currency",
          "status",
          "refundStatus",
          "refundedAmount",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
          reference: { type: "string" },
          customer: { $ref: "#/components/schemas/Customer" },
          items: { type: "array", items: { $ref: "#/components/schemas/OrderItem" } },
          subtotal: { type: "integer", minimum: 0 },
          total: { type: "integer", minimum: 0 },
          currency: { $ref: "#/components/schemas/Currency" },
          status: { type: "string", enum: ["pending", "paid", "payment_failed", "cancelled"] },
          refundStatus: {
            type: "string",
            enum: ["none", "pending", "partially_refunded", "fully_refunded", "failed"],
          },
          refundedAmount: { type: "integer", minimum: 0 },
          stripeCheckoutSessionId: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      CheckoutResponse: {
        type: "object",
        required: ["checkoutUrl"],
        properties: {
          checkoutUrl: {
            type: "string",
            format: "uri",
            description: "Hosted Stripe Checkout URL; use test-mode checkout only.",
          },
        },
      },
      WebhookAcknowledgement: {
        type: "object",
        required: ["received", "duplicate"],
        properties: {
          received: { type: "boolean" },
          duplicate: { type: "boolean" },
        },
      },
      AdminLoginRequest: {
        type: "object",
        additionalProperties: false,
        required: ["username", "password"],
        properties: {
          username: { type: "string", minLength: 1, maxLength: 100 },
          password: { type: "string", minLength: 1, maxLength: 512, writeOnly: true },
        },
      },
      AdminSession: {
        type: "object",
        required: ["token", "expiresAt"],
        properties: {
          token: { type: "string", description: "Private signed bearer token; not shown as a sample." },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
      CurrencyAmount: {
        type: "object",
        required: ["currency", "amount"],
        properties: {
          currency: { $ref: "#/components/schemas/Currency" },
          amount: { type: "integer", description: "Integer minor currency units." },
        },
      },
      AdminOrderSummary: {
        type: "object",
        required: [
          "id",
          "reference",
          "customer",
          "createdAt",
          "total",
          "currency",
          "status",
          "paymentStatus",
          "refundStatus",
          "refundedAmount",
        ],
        properties: {
          id: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
          reference: { type: "string" },
          customer: { $ref: "#/components/schemas/Customer" },
          createdAt: { type: "string", format: "date-time" },
          total: { type: "integer", minimum: 0 },
          currency: { $ref: "#/components/schemas/Currency" },
          status: { type: "string", enum: ["pending", "paid", "payment_failed", "cancelled"] },
          paymentStatus: {
            type: "string",
            enum: ["pending", "paid", "payment_failed", "cancelled", "not_started"],
          },
          refundStatus: {
            type: "string",
            enum: ["none", "pending", "partially_refunded", "fully_refunded", "failed"],
          },
          refundedAmount: { type: "integer", minimum: 0 },
        },
      },
      AdminOverview: {
        type: "object",
        required: [
          "totalOrders",
          "pendingOrders",
          "paidRevenue",
          "failedPayments",
          "paymentSuccessRate",
          "recentOrders",
        ],
        properties: {
          totalOrders: { type: "integer", minimum: 0 },
          pendingOrders: { type: "integer", minimum: 0 },
          paidRevenue: { type: "array", items: { $ref: "#/components/schemas/CurrencyAmount" } },
          failedPayments: { type: "integer", minimum: 0 },
          paymentSuccessRate: {
            nullable: true,
            allOf: [{ $ref: "#/components/schemas/PaymentSuccessRate" }],
          },
          recentOrders: {
            type: "array",
            items: { $ref: "#/components/schemas/AdminOrderSummary" },
          },
        },
      },
      PaymentSuccessRate: {
        type: "object",
        required: ["percentage", "paid", "terminal"],
        properties: {
          percentage: { type: "number", minimum: 0, maximum: 100 },
          paid: { type: "integer", minimum: 0 },
          terminal: { type: "integer", minimum: 1 },
        },
      },
      AdminOrderList: {
        type: "object",
        required: ["total", "limit", "orders"],
        properties: {
          total: { type: "integer", minimum: 0 },
          limit: { type: "integer", enum: [100] },
          orders: { type: "array", items: { $ref: "#/components/schemas/AdminOrderSummary" } },
        },
      },
      AdminPayment: {
        type: "object",
        required: [
          "id",
          "orderReference",
          "stripeCheckoutSessionId",
          "amount",
          "currency",
          "status",
          "provider",
          "refundStatus",
          "refundedAmount",
          "pendingRefundAmount",
          "remainingRefundableAmount",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
          orderReference: { type: "string" },
          stripeCheckoutSessionId: { type: "string" },
          amount: { type: "integer", minimum: 0 },
          currency: { $ref: "#/components/schemas/Currency" },
          status: { type: "string", enum: ["pending", "paid", "payment_failed", "cancelled"] },
          provider: { type: "string", enum: ["stripe"] },
          refundStatus: {
            type: "string",
            enum: ["none", "pending", "partially_refunded", "fully_refunded", "failed"],
          },
          refundedAmount: { type: "integer", minimum: 0 },
          pendingRefundAmount: { type: "integer", minimum: 0 },
          remainingRefundableAmount: { type: "integer", minimum: 0 },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      AdminOrderDetail: {
        type: "object",
        required: [
          "order",
          "customer",
          "items",
          "subtotal",
          "total",
          "currency",
          "createdAt",
          "updatedAt",
          "payments",
          "refunds",
        ],
        properties: {
          order: { $ref: "#/components/schemas/AdminOrderSummary" },
          customer: { $ref: "#/components/schemas/Customer" },
          items: { type: "array", items: { $ref: "#/components/schemas/OrderItem" } },
          subtotal: { type: "integer", minimum: 0 },
          total: { type: "integer", minimum: 0 },
          currency: { $ref: "#/components/schemas/Currency" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          payments: { type: "array", items: { $ref: "#/components/schemas/AdminPayment" } },
          refunds: { type: "array", items: { $ref: "#/components/schemas/AdminRefund" } },
        },
      },
      AdminRefund: {
        type: "object",
        required: [
          "id",
          "stripeRefundId",
          "paymentId",
          "orderReference",
          "amount",
          "currency",
          "status",
          "reason",
          "failureReason",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          id: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
          stripeRefundId: { type: "string", nullable: true },
          paymentId: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
          orderReference: { type: "string" },
          amount: { type: "integer", minimum: 1 },
          currency: { $ref: "#/components/schemas/Currency" },
          status: { type: "string", enum: ["pending", "succeeded", "failed"] },
          reason: { type: "string", nullable: true },
          failureReason: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      RefundRequest: {
        type: "object",
        additionalProperties: false,
        required: ["paymentId", "amount", "idempotencyKey"],
        properties: {
          paymentId: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
          amount: {
            type: "integer",
            minimum: 1,
            description: "Integer minor currency units; must not exceed the remaining refundable balance.",
          },
          reason: {
            type: "string",
            enum: ["duplicate", "fraudulent", "requested_by_customer"],
          },
          idempotencyKey: { type: "string", format: "uuid" },
        },
      },
      RefundResponse: {
        type: "object",
        required: ["refund", "payment", "remainingRefundableAmount"],
        properties: {
          refund: { $ref: "#/components/schemas/AdminRefund" },
          payment: { $ref: "#/components/schemas/AdminPayment" },
          remainingRefundableAmount: { type: "integer", minimum: 0 },
        },
      },
      WebhookEvent: {
        type: "object",
        required: ["eventId", "type", "status", "createdAt", "processedAt"],
        properties: {
          eventId: { type: "string", pattern: "^evt_[A-Za-z0-9]+$" },
          type: { type: "string" },
          status: { type: "string", enum: ["processed"] },
          createdAt: { type: "string", format: "date-time" },
          processedAt: { type: "string", format: "date-time", nullable: true },
        },
      },
      PendingOrderInvestigation: {
        oneOf: [
          {
            type: "object",
            required: ["found", "reference"],
            properties: {
              found: { type: "boolean", enum: [false] },
              reference: { type: "string" },
            },
          },
          {
            type: "object",
            required: ["found", "order", "payments", "recentCheckoutEvents", "eventOrderCorrelationAvailable"],
            properties: {
              found: { type: "boolean", enum: [true] },
              order: {
                type: "object",
                required: ["id", "reference", "status", "total", "currency", "items", "hasCheckoutSessionId", "createdAt", "updatedAt"],
                properties: {
                  id: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
                  reference: { type: "string" },
                  status: { type: "string", enum: ["pending", "paid", "payment_failed", "cancelled"] },
                  total: { type: "integer", minimum: 0 },
                  currency: { $ref: "#/components/schemas/Currency" },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["name", "quantity", "unitPrice"],
                      properties: {
                        name: { type: "string" },
                        quantity: { type: "integer", minimum: 1 },
                        unitPrice: { type: "integer", minimum: 0 },
                      },
                    },
                  },
                  hasCheckoutSessionId: { type: "boolean" },
                  createdAt: { type: "string", format: "date-time" },
                  updatedAt: { type: "string", format: "date-time" },
                },
              },
              payments: { type: "array", items: { $ref: "#/components/schemas/AdminPayment" } },
              recentCheckoutEvents: {
                type: "array",
                items: { $ref: "#/components/schemas/WebhookEvent" },
              },
              eventOrderCorrelationAvailable: { type: "boolean", enum: [false] },
            },
          },
        ],
      },
      AdminAnalytics: {
        type: "object",
        required: ["filters", "currencies", "metrics", "charts"],
        properties: {
          filters: {
            type: "object",
            required: ["from", "to", "currency", "orderStatus", "refundStatus"],
            properties: {
              from: { type: "string", format: "date", nullable: true },
              to: { type: "string", format: "date", nullable: true },
              currency: { allOf: [{ $ref: "#/components/schemas/Currency" }], nullable: true },
              orderStatus: {
                type: "string",
                enum: ["pending", "paid", "payment_failed", "cancelled"],
                nullable: true,
              },
              refundStatus: {
                type: "string",
                enum: ["pending", "succeeded", "failed"],
                nullable: true,
              },
            },
          },
          currencies: { type: "array", items: { $ref: "#/components/schemas/Currency" } },
          metrics: {
            type: "object",
            required: [
              "totalOrders",
              "paidOrders",
              "pendingOrders",
              "failedOrders",
              "grossRevenue",
              "totalRefunded",
              "netRevenue",
              "averageOrderValue",
              "refundRate",
              "paymentSuccessRate",
            ],
            properties: {
              totalOrders: { type: "integer", minimum: 0 },
              paidOrders: { type: "integer", minimum: 0 },
              pendingOrders: { type: "integer", minimum: 0 },
              failedOrders: { type: "integer", minimum: 0 },
              grossRevenue: { type: "array", items: { $ref: "#/components/schemas/CurrencyAmount" } },
              totalRefunded: { type: "array", items: { $ref: "#/components/schemas/CurrencyAmount" } },
              netRevenue: { type: "array", items: { $ref: "#/components/schemas/CurrencyAmount" } },
              averageOrderValue: { type: "array", items: { $ref: "#/components/schemas/CurrencyAmount" } },
              refundRate: {
                nullable: true,
                allOf: [{
                  type: "object",
                  required: ["percentage", "refundedOrders", "paidOrders"],
                  properties: {
                    percentage: { type: "number", minimum: 0, maximum: 100 },
                    refundedOrders: { type: "integer", minimum: 0 },
                    paidOrders: { type: "integer", minimum: 0 },
                  },
                }],
              },
              paymentSuccessRate: {
                nullable: true,
                allOf: [{
                  type: "object",
                  required: ["percentage", "paidOrders", "terminalOrders"],
                  properties: {
                    percentage: { type: "number", minimum: 0, maximum: 100 },
                    paidOrders: { type: "integer", minimum: 0 },
                    terminalOrders: { type: "integer", minimum: 0 },
                  },
                }],
              },
            },
          },
          charts: {
            type: "object",
            required: ["revenueOverTime", "ordersOverTime", "ordersByStatus", "revenueByProduct", "refundsOverTime"],
            properties: {
              revenueOverTime: {
                type: "array",
                items: {
                  type: "object",
                  required: ["date", "currency", "amount"],
                  properties: {
                    date: { type: "string", format: "date" },
                    currency: { $ref: "#/components/schemas/Currency" },
                    amount: { type: "integer", minimum: 0 },
                  },
                },
              },
              ordersOverTime: {
                type: "array",
                items: {
                  type: "object",
                  required: ["date", "status", "count"],
                  properties: {
                    date: { type: "string", format: "date" },
                    status: { type: "string", enum: ["pending", "paid", "payment_failed", "cancelled"] },
                    count: { type: "integer", minimum: 0 },
                  },
                },
              },
              ordersByStatus: {
                type: "array",
                items: {
                  type: "object",
                  required: ["status", "count"],
                  properties: {
                    status: { type: "string", enum: ["pending", "paid", "payment_failed", "cancelled"] },
                    count: { type: "integer", minimum: 0 },
                  },
                },
              },
              revenueByProduct: {
                type: "array",
                items: {
                  type: "object",
                  required: ["productId", "name", "currency", "amount", "quantity"],
                  properties: {
                    productId: { type: "string", pattern: "^[a-fA-F0-9]{24}$" },
                    name: { type: "string", minLength: 1 },
                    currency: { $ref: "#/components/schemas/Currency" },
                    amount: { type: "integer", minimum: 0 },
                    quantity: { type: "integer", minimum: 0 },
                  },
                },
              },
              refundsOverTime: {
                type: "array",
                items: {
                  type: "object",
                  required: ["date", "currency", "status", "amount", "count"],
                  properties: {
                    date: { type: "string", format: "date" },
                    currency: { $ref: "#/components/schemas/Currency" },
                    status: { type: "string", enum: ["pending", "succeeded", "failed"] },
                    amount: { type: "integer", minimum: 0 },
                    count: { type: "integer", minimum: 0 },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
