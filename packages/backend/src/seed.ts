import { MongoClient } from "mongodb";
import { config } from "./config.js";
import { ProductSchema } from "./products/product.schema.js";

const SeedProductSchema = ProductSchema.omit({ _id: true, createdAt: true, updatedAt: true });

const seedProducts = [
  {
    name: "Studio Wireless Headphones",
    description: "Immersive over-ear sound with plush cushions and all-day comfort.",
    price: 12999,
    currency: "USD",
    category: "Audio",
    imageUrl:
      "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=900&q=85",
    stock: 24,
    active: true,
  },
  {
    name: "Precision Wireless Mouse",
    description: "A quiet, ergonomic mouse with precise tracking for work or play.",
    price: 5999,
    currency: "USD",
    category: "Accessories",
    imageUrl:
      "https://images.unsplash.com/photo-1527814050087-3793815479db?auto=format&fit=crop&w=900&q=85",
    stock: 38,
    active: true,
  },
  {
    name: "Mechanical Keyboard",
    description: "A compact mechanical keyboard with a satisfying, tactile feel.",
    price: 10999,
    currency: "USD",
    category: "Accessories",
    imageUrl:
      "https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=900&q=85",
    stock: 16,
    active: true,
  },
  {
    name: "Everyday Smartwatch",
    description: "A clean, versatile smartwatch to keep your day in sync.",
    price: 17999,
    currency: "USD",
    category: "Wearables",
    imageUrl:
      "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85",
    stock: 11,
    active: true,
  },
  {
    name: "Portable Bluetooth Speaker",
    description: "Room-filling sound in a compact speaker made to move with you.",
    price: 8499,
    currency: "USD",
    category: "Audio",
    imageUrl:
      "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=900&q=85",
    stock: 20,
    active: true,
  },
  {
    name: "USB-C Multiport Hub",
    description: "Add the ports you need with a pocket-sized aluminum hub.",
    price: 4999,
    currency: "USD",
    category: "Accessories",
    imageUrl:
      "https://images.unsplash.com/photo-1625948515291-69613efd103f?auto=format&fit=crop&w=900&q=85",
    stock: 32,
    active: true,
  },
  {
    name: "Minimal Desk Lamp",
    description: "A warm, adjustable glow that makes your workspace feel right.",
    price: 6999,
    currency: "USD",
    category: "Workspace",
    imageUrl:
      "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85",
    stock: 14,
    active: true,
  },
  {
    name: "Insulated Travel Tumbler",
    description: "A durable double-wall tumbler for good coffee on the go.",
    price: 2799,
    currency: "USD",
    category: "Everyday",
    imageUrl:
      "https://images.unsplash.com/photo-1517256673644-36ad11246d21?auto=format&fit=crop&w=900&q=85",
    stock: 45,
    active: true,
  },
];

const now = new Date();
const products = seedProducts.map((product) =>
  SeedProductSchema.parse(product),
);

async function seed(): Promise<void> {
  const client = new MongoClient(config.MONGODB_URI);

  try {
    await client.connect();
    const collection = client.db("paybridge").collection("products");
    const operations = products.map((product) => ({
      updateOne: {
        filter: { name: product.name },
        update: {
          $setOnInsert: { createdAt: now },
          $set: { ...product, updatedAt: now },
        },
        upsert: true,
      },
    }));

    const result = await collection.bulkWrite(operations);
    console.log(
      `Seed complete: ${result.upsertedCount} inserted, ${result.modifiedCount} updated.`,
    );
  } finally {
    await client.close();
  }
}

seed().catch((error: unknown) => {
  console.error("Failed to seed products", error);
  process.exitCode = 1;
});
