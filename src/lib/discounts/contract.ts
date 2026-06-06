export interface CartItem {
  sku: string;
  name: string;
  category: string;
  qty: number;
  unitPrice: number; // pence
}

export interface Cart {
  items: CartItem[];
  subtotal: number; // pence
  placedAt: string; // ISO 8601
}

export interface DiscountResult {
  discount: number; // pence to subtract
  explanation: string;
}

export interface DiscountRule {
  id: string;
  describe(): string;
  apply(cart: Cart): DiscountResult;
}
