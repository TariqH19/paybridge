import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDatabase } from "../db.js";
import { ProductSchema } from "../products/product.schema.js";
import { CreateOrderRequestSchema, OrderResponseSchema } from "./order.schema.js";
import { buildOrder, OrderCreationError } from "./order.service.js";

export const ordersRouter = Router();

ordersRouter.post("/", async (request, response, next) => {
  const parsedRequest = CreateOrderRequestSchema.safeParse(request.body);
  if (!parsedRequest.success) {
    response.status(400).json({
      error: "Invalid order request",
      details: parsedRequest.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  try {
    const requestedItems = parsedRequest.data.items;
    const products = await getDatabase()
      .collection("products")
      .find({
        _id: { $in: requestedItems.map(({ productId }) => new ObjectId(productId)) },
        active: true,
      })
      .toArray();
    const order = buildOrder(
      parsedRequest.data,
      products.map((product) => ProductSchema.parse(product)),
    );
    const result = await getDatabase().collection("orders").insertOne(order);

    response.status(201).json(
      OrderResponseSchema.parse({
        ...order,
        _id: result.insertedId,
      }),
    );
  } catch (error) {
    if (error instanceof OrderCreationError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    next(error);
  }
});
