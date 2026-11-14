export type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  category: string;
  imageUrl: string;
  stock: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CartItem = {
  productId: string;
  quantity: number;
};

export type CartRow = {
  item: CartItem;
  product: Product | undefined;
};

export type OrderItem = {
  productId: string;
  name: string;
  imageUrl: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  currency: string;
};

export type CreatedOrder = {
  id: string;
  reference: string;
  customer: { name: string; email: string };
  items: OrderItem[];
  subtotal: number;
  total: number;
  currency: string;
  status: "pending";
  createdAt: string;
  updatedAt: string;
};
