import { ObjectId } from "mongodb";
import { z } from "zod";

export const ProductSchema = z.object({
  _id: z.instanceof(ObjectId),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  price: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  category: z.string().trim().min(1).max(60),
  imageUrl: z.url(),
  stock: z.number().int().nonnegative(),
  active: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Product = z.infer<typeof ProductSchema>;

export const ProductResponseSchema = ProductSchema.transform(({ _id, ...product }) => ({
  ...product,
  id: _id.toHexString(),
}));

export type ProductResponse = z.infer<typeof ProductResponseSchema>;
