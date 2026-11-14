import assert from "node:assert/strict";
import test from "node:test";
import { CreateOrderRequestSchema } from "./order.schema.js";

const validRequest = {
  customer: { name: "Avery Smith", email: "avery@example.com" },
  items: [{ productId: "0123456789abcdef01234567", quantity: 2 }],
};

test("accepts a customer and product ID/quantity request", () => {
  assert.equal(CreateOrderRequestSchema.safeParse(validRequest).success, true);
});

test("rejects invalid IDs, quantities, and client-supplied prices", () => {
  assert.equal(
    CreateOrderRequestSchema.safeParse({
      ...validRequest,
      items: [{ productId: "not-an-object-id", quantity: 1 }],
    }).success,
    false,
  );
  assert.equal(
    CreateOrderRequestSchema.safeParse({
      ...validRequest,
      items: [{ productId: validRequest.items[0].productId, quantity: 0 }],
    }).success,
    false,
  );
  assert.equal(
    CreateOrderRequestSchema.safeParse({
      ...validRequest,
      items: [{ ...validRequest.items[0], price: 1 }],
    }).success,
    false,
  );
});
