import type { CartItem } from "./types";

const CART_STORAGE_KEY = "paybridge-cart-v1";

function isCartItem(value: unknown): value is CartItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.productId === "string" &&
    /^[a-f\d]{24}$/i.test(item.productId) &&
    typeof item.quantity === "number" &&
    Number.isInteger(item.quantity) &&
    item.quantity >= 1 &&
    item.quantity <= 99
  );
}

export function readStoredCart(): { items: CartItem[]; error: string | null } {
  let storedValue: string | null;
  try {
    storedValue = localStorage.getItem(CART_STORAGE_KEY);
  } catch {
    return {
      items: [],
      error: "Your browser could not access the saved cart.",
    };
  }

  if (!storedValue) {
    return { items: [], error: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(storedValue);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    return {
      items: [],
      error: "Your saved cart could not be read and has been cleared.",
    };
  }

  if (!Array.isArray(parsed) || !parsed.every(isCartItem)) {
      return {
        items: [],
        error: "Your saved cart could not be read and has been cleared.",
      };
  }

  return {
    items: parsed.map(({ productId, quantity }) => ({ productId, quantity })),
    error: null,
  };
}

export function saveCart(items: CartItem[]): void {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
}
