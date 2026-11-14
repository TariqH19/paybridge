import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { ProductSchema } from "./product.schema.js";

const validProduct = {
  _id: new ObjectId(),
  name: "Studio Headphones",
  description: "Comfortable over-ear headphones.",
  price: 12999,
  currency: "USD",
  category: "Audio",
  imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e",
  stock: 12,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

test("accepts a valid product with a price in minor currency units", () => {
  assert.equal(ProductSchema.parse(validProduct).price, 12999);
});

test("rejects negative or fractional prices", () => {
  assert.equal(ProductSchema.safeParse({ ...validProduct, price: -1 }).success, false);
  assert.equal(ProductSchema.safeParse({ ...validProduct, price: 12.5 }).success, false);
});
