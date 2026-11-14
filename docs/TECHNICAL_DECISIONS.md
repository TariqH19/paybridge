# PayBridge Technical Decisions

## Context

This document describes the architecture visible in the current codebase and the trade-offs of its implementation. The repository does not contain formal Architecture Decision Records; alternatives below explain the current design rationale and are not a claim that every option was historically benchmarked or evaluated.

## MongoDB document model

**Implemented:** MongoDB Atlas is the sole application database, accessed through the official Node.js driver. Orders embed customer details and purchase-time item snapshots. Payments and refunds are separate documents.

**Rationale:** Product catalogue and order snapshots are naturally document-shaped. Embedding the line items makes an order and its purchase-time display values available together, without reconstructing the order from mutable catalogue documents. MongoDB aggregation pipelines support the dashboard's filtered summaries and time-series reports. Atlas also provides the managed deployment model already used by the project.

**Relational alternative:** A relational design could normalize products, order lines, payment attempts, and refunds into tables with foreign keys and constraints. That would make referential integrity and some cross-entity reporting more declarative. It would also require joins to reconstruct an order. The current MongoDB approach keeps the order snapshot cohesive, but relationships between collections are application-enforced rather than foreign-key-enforced.

**Trade-off:** Order snapshots duplicate product names/images/prices, and payment/refund documents duplicate order references and summary totals. This improves historical stability and operational lookup simplicity, but requires reconciliation logic and can introduce drift if data is changed outside the application. Zod validates application reads/writes; collection-level MongoDB schema validators are not configured.

## Embedded order snapshots; separate payment and refund records

**Implemented:** Orders embed customer fields and item snapshots. Payments have their own Checkout Session/PaymentIntent identifiers and status. Each refund is an individual document linked to an order and payment.

**Rationale:** Product catalogue changes must not rewrite a completed order's purchased product name or price. Payment attempts and refunds have independent lifecycles and can be multiple per order/payment. A separate refund ledger allows partial refunds to be audited and summed without overwriting prior refund details.

**Alternative:** Normalizing each order line or storing refund history as an array inside a payment could reduce collection count or duplication. Separate refund documents avoid growing a single payment document's refund array and provide direct idempotency/index keys, at the cost of transactional updates and aggregation to maintain payment/order summary fields.

**Trade-off:** The product ID in an order item is a string snapshot reference, not a foreign key. A product can change or disappear without invalidating the order, but referential integrity is not automatic. `orderId` and `paymentId` ObjectIds are checked by application logic.

## Hosted Stripe Checkout and backend-owned prices

**Implemented:** The browser submits product IDs and quantities to order creation. The backend reloads active products, checks current stock and shared currency, calculates integer totals, and persists the order. The backend creates a Stripe Checkout Session from the stored order snapshot and redirects the browser to Stripe-hosted Checkout.

**Rationale:** Stripe handles collection of payment details and the hosted payment UI; PayBridge does not receive card numbers. Server-side product lookup prevents the browser from choosing order prices. Stripe is configured lazily and restricted to standard `sk_test_` keys, so product-catalogue routes do not need Stripe configuration.

**Alternative:** A fully custom payment form would give more control over UX but would increase payment-data handling and compliance/security scope. A client-created payment session would weaken server control over order content.

**Trade-off:** Checkout creation spans Stripe and MongoDB, so no distributed transaction can make both writes atomic. Session idempotency, reuse of open sessions, and webhook-side payment upsert mitigate retry and partial-failure cases. The storefront's current amount formatter assumes two decimal places; additional currency exponent support is required before claiming correct display for all Stripe currencies.

## Webhook authority and idempotency

**Implemented:** Express receives the Stripe webhook body as raw bytes before JSON middleware, verifies the Stripe signature, and processes the event in a MongoDB transaction. Event IDs are checked and stored under a unique index. Checkout event state is matched against stored order/payment metadata, amount, and currency. Browser success redirects do not update payment status.

**Rationale:** Webhooks are asynchronous and retried; they provide a verified server-to-server signal rather than relying on a browser redirect that can be forged, skipped, or delayed. Event-ID deduplication and transactionally coupled state/event writes make repeated delivery safe within the application model.

**Alternative:** The success page could poll Stripe or mark an order paid on return. That would make payment state depend on a browser and expose an unreliable confirmation path. Polling may still be a future UX enhancement, but it must not replace verified server-side state changes.

**Trade-off:** `stripeWebhookEvents` stores processed event metadata, not raw payloads or failed delivery attempts. This limits sensitive-data retention, but also limits post hoc investigation and order/event correlation. Stripe remains responsible for retrying failed deliveries; the application does not maintain a separate dead-letter queue.

## Integer minor-unit money

**Implemented:** Product prices, order item prices/totals, payment amounts, and refund amounts are integer minor units. Backend multiplication and addition are guarded with safe-integer checks. Stripe receives the stored integer amount and currency.

**Rationale:** Integer arithmetic avoids floating-point rounding in price, subtotal, and refund-balance calculations. Amounts are never summed across different currencies in Analytics.

**Alternative:** Decimal floating-point arithmetic is easier to format but risks rounding errors. A decimal library could support richer precision rules, but is unnecessary for the current integer-unit model.

**Trade-off:** Currency exponent rules differ. The database schema accepts three-letter currencies, while storefront formatting currently divides by 100. Currency-specific formatting/validation should be added before expanding beyond the current cent-based catalogue.

## Refund reconciliation

**Implemented:** The backend transactionally reserves refund balance and creates a refund ledger record before calling Stripe. The Stripe API response and verified refund webhook events flow through a shared reconciliation service. Stable internal and Stripe idempotency keys protect retries. Payment and order refund summaries are recomputed from refund records; a successful refund does not rewrite the order's paid status.

**Rationale:** A reservation prevents concurrent requests from exceeding the remaining refundable amount. Keeping each refund separate records partial refund history. Reconciliation against Stripe outcomes avoids treating a request submission as proof of success.

**Alternative:** Updating the order/payment as refunded immediately upon request would be simpler but could misstate a refund that Stripe later fails. A single mutable `refundedAmount` without refund records would lose per-refund auditability.

**Trade-off:** Refund initiation depends on MongoDB transactions and Stripe availability. If Stripe's response is ambiguous, the reservation remains pending and retry must use the same request key. Operational handling for long-stuck pending refunds is not automated.

## Admin authentication

**Implemented:** Admin username, password, and signing secret are backend environment values. Login returns an eight-hour HMAC-signed bearer token; all admin routes other than session creation pass through backend authentication. The frontend stores the token in session storage.

**Rationale:** This is a small, dependency-free protection appropriate for a single-operator portfolio demo. API authorization is enforced server-side, rather than relying on hiding the `/admin` page.

**Alternative:** A managed identity provider or user/role store would support user lifecycle, MFA, and delegated access. A cookie session could reduce JavaScript access to credentials but would require CSRF/session configuration.

**Trade-off:** There is one configured identity, no roles, no server-side revocation, no persistent session registry, and no MFA/rate-limiting system. This is not a production-grade multi-user administrative identity architecture.

## On-demand analytics

**Implemented:** MongoDB aggregation pipelines compute current metrics and charts from orders and refunds when the admin requests them. Relevant compound indexes are created at backend startup; API and response filters are validated with Zod.

**Rationale:** This keeps metrics tied to stored order/refund data and avoids maintaining a second reporting store or fabricated frontend metrics. Currency grouping and status/date filters happen in MongoDB rather than downloading all documents into React.

**Alternative:** Materialized daily rollups or a separate analytical warehouse could reduce repeated aggregation work at larger data volumes, but would add asynchronous consistency and maintenance complexity.

**Trade-off:** Analytics requests have no default date window, materialized rollup, or pagination. Large collections may require query limits, additional index tuning, and pre-aggregation based on measured workload. No performance benchmark is claimed.

## Current architectural gaps

- **Inventory concurrency:** Orders check stock but do not decrement or reserve it. Two customers can both pass the same stock check.
- **Database-enforced validation:** Zod is application-level; there are no MongoDB collection validators, and foreign-key-like relationships are not database-enforced.
- **Admin security maturity:** Authentication is a single static environment-configured account and signed token. No role model, revocation, MFA, or production identity integration exists.
- **Webhook observability:** Only successfully processed event metadata is persisted. Raw payloads, processing attempts/failures, and a durable dead-letter workflow are absent.
- **Cross-system checkout consistency:** Stripe Session creation and MongoDB persistence cannot be one atomic transaction. Existing idempotency and webhook recovery reduce risk but do not provide distributed commit.
- **Analytics scale:** Pipelines operate on live collections without a default date range or rollup strategy; workload needs measurement before scaling claims can be made.
- **Currency formatting:** Storefront formatting assumes two fractional digits even though schemas permit other currency codes.
- **Metric semantics:** Overview payment success rate counts terminal payment records, while Analytics counts terminal order statuses. Retries can produce different rates.
- **Business scope:** No customer accounts, tax/shipping calculations, stock reservation, multi-merchant tenancy, outbound merchant webhooks, or live Stripe mode is implemented.
