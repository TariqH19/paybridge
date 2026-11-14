import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { ProductSchema } from "../products/product.schema.js";
import { CreateOrderRequestSchema } from "./order.schema.js";
import { buildOrder, OrderCreationError } from "./order.service.js";

const productId = new ObjectId("0123456789abcdef01234567");
const product = ProductSchema.parse({
  _id: productId,
  name: "Studio Headphones",
  description: "Comfortable over-ear headphones.",
  price: 12999,
  currency: "USD",
  category: "Audio",
  imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e",
  stock: 5,
  active: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
});
const request = CreateOrderRequestSchema.parse({
  customer: { name: "Avery Smith", email: "avery@example.com" },
  items: [{ productId: productId.toHexString(), quantity: 2 }],
});

test("calculates order totals from current product prices in minor units", () => {
  const order = buildOrder(request, [product], "PB-TEST-ORDER");

  assert.equal(order.items[0].unitPrice, 12999);
  assert.equal(order.items[0].lineTotal, 25998);
  assert.equal(order.subtotal, 25998);
  assert.equal(order.total, 25998);
  assert.equal(order.status, "pending");
});

test("rejects orders exceeding available stock", () => {
  assert.throws(
    () =>
      buildOrder(
        CreateOrderRequestSchema.parse({
          ...request,
          items: [{ productId: productId.toHexString(), quantity: 6 }],
        }),
        [product],
      ),
    (error: unknown) =>
      error instanceof OrderCreationError &&
      error.statusCode === 409 &&
      error.message.includes("stock"),
  );
});
