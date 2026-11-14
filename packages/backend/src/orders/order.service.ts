import { randomUUID } from "node:crypto";
import type { Product } from "../products/product.schema.js";
import type { CreateOrderRequest, NewOrder } from "./order.schema.js";

export class OrderCreationError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 409 | 422,
  ) {
    super(message);
    this.name = "OrderCreationError";
  }
}

export function createOrderReference(): string {
  return `PB-${randomUUID().toUpperCase()}`;
}

export function buildOrder(
  request: CreateOrderRequest,
  products: Product[],
  reference = createOrderReference(),
  now = new Date(),
): NewOrder {
  const productById = new Map(products.map((product) => [product._id.toHexString(), product]));
  const seenProductIds = new Set<string>();
  const items = request.items.map(({ productId, quantity }) => {
    const normalizedProductId = productId.toLowerCase();
    if (seenProductIds.has(normalizedProductId)) {
      throw new OrderCreationError("Each product may only appear once in an order.", 400);
    }
    seenProductIds.add(normalizedProductId);

    const product = productById.get(normalizedProductId);
    if (!product || !product.active) {
      throw new OrderCreationError("One or more products are unavailable.", 409);
    }
    if (product.stock < quantity) {
      throw new OrderCreationError(`Not enough stock available for ${product.name}.`, 409);
    }

    const lineTotal = product.price * quantity;
    if (!Number.isSafeInteger(lineTotal)) {
      throw new OrderCreationError("The order total is too large.", 422);
    }

    return {
      productId: normalizedProductId,
      name: product.name,
      imageUrl: product.imageUrl,
      unitPrice: product.price,
      quantity,
      lineTotal,
      currency: product.currency,
    };
  });

  const currency = items[0].currency;
  if (items.some((item) => item.currency !== currency)) {
    throw new OrderCreationError("All items in an order must use the same currency.", 400);
  }

  const subtotal = items.reduce((sum, item) => {
    const nextTotal = sum + item.lineTotal;
    if (!Number.isSafeInteger(nextTotal)) {
      throw new OrderCreationError("The order total is too large.", 422);
    }
    return nextTotal;
  }, 0);

  return {
    reference,
    customer: request.customer,
    items,
    subtotal,
    total: subtotal,
    currency,
    status: "pending",
    refundStatus: "none",
    refundedAmount: 0,
    createdAt: now,
    updatedAt: now,
  };
}
