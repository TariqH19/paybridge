import { Db, MongoClient } from "mongodb";
import { config } from "./config.js";

const client = new MongoClient(config.MONGODB_URI);
let database: Db | undefined;

export async function connectToDatabase(): Promise<Db> {
  await client.connect();
  database = client.db("paybridge");

  await database.collection("products").createIndexes([
    { key: { active: 1, category: 1, name: 1 }, name: "active_category_name" },
    { key: { createdAt: -1 }, name: "created_at_desc" },
  ]);
  await database.collection("orders").createIndexes([
    { key: { currency: 1, status: 1, createdAt: -1 }, name: "order_currency_status_created_at" },
    { key: { createdAt: -1 }, name: "order_created_at_desc" },
    { key: { reference: 1 }, unique: true, name: "order_reference_unique" },
    { key: { status: 1, createdAt: -1 }, name: "order_status_created_at" },
    { key: { "customer.email": 1, createdAt: -1 }, name: "order_customer_email_created_at" },
  ]);
  await database.collection("payments").createIndexes([
    { key: { createdAt: -1 }, name: "payment_created_at_desc" },
    { key: { refundStatus: 1, updatedAt: -1 }, name: "payment_refund_status_updated_at" },
    {
      key: { stripeCheckoutSessionId: 1 },
      unique: true,
      name: "stripe_checkout_session_unique",
    },
    { key: { orderId: 1, createdAt: -1 }, name: "payment_order_created_at" },
    { key: { status: 1, updatedAt: -1 }, name: "payment_status_updated_at" },
  ]);
  await database.collection("stripeWebhookEvents").createIndexes([
    { key: { eventId: 1 }, unique: true, name: "stripe_event_id_unique" },
    { key: { createdAt: -1 }, name: "stripe_event_created_at" },
  ]);
  await database.collection("refunds").createIndexes([
    { key: { idempotencyKey: 1 }, unique: true, name: "refund_idempotency_unique" },
    {
      key: { stripeRefundId: 1 },
      unique: true,
      sparse: true,
      name: "stripe_refund_id_unique",
    },
    { key: { orderId: 1, createdAt: -1 }, name: "refund_order_created_at" },
    { key: { paymentId: 1, createdAt: -1 }, name: "refund_payment_created_at" },
    {
      key: { currency: 1, status: 1, createdAt: -1 },
      name: "refund_currency_status_created_at",
    },
  ]);

  return database;
}

export function getDatabase(): Db {
  if (!database) {
    throw new Error("Database has not been connected");
  }

  return database;
}

export function getMongoClient(): MongoClient {
  return client;
}

export async function closeDatabase(): Promise<void> {
  await client.close();
  database = undefined;
}
