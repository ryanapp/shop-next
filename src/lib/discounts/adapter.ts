import type { CartSummary } from "../cart";
import type { Cart } from "./contract";

export function cartSummaryToDiscountCart(
  summary: CartSummary,
  placedAt: string
): Cart {
  return {
    items: summary.lines.map((line) => ({
      sku: line.sku,
      name: line.name,
      category: line.category,
      qty: line.quantity,
      unitPrice: line.unitPricePence
    })),
    subtotal: summary.subtotalPence,
    placedAt
  };
}
