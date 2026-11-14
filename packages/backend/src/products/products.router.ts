import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDatabase } from "../db.js";
import { ProductResponseSchema, ProductSchema } from "./product.schema.js";

export const productsRouter = Router();

productsRouter.get("/", async (_request, response, next) => {
  try {
    const products = await getDatabase()
      .collection("products")
      .find({ active: true })
      .sort({ category: 1, name: 1 })
      .toArray();
    const result = products.map((product) => ProductResponseSchema.parse(product));

    response.json(result);
  } catch (error) {
    next(error);
  }
});

productsRouter.get("/:id", async (request, response, next) => {
  const { id } = request.params;

  if (!ObjectId.isValid(id)) {
    response.status(400).json({ error: "Invalid product ID" });
    return;
  }

  try {
    const product = await getDatabase()
      .collection("products")
      .findOne({ _id: new ObjectId(id), active: true });

    if (!product) {
      response.status(404).json({ error: "Product not found" });
      return;
    }

    response.json(ProductResponseSchema.parse(product));
  } catch (error) {
    next(error);
  }
});
