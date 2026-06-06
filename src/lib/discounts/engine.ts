import type { Cart, DiscountRule } from "./contract";

export type AppliedDiscount = {
  ruleId: string;
  description: string;
  discountPence: number;
  explanation: string;
};

export type DiscountPricing = {
  subtotalPence: number;
  discounts: AppliedDiscount[];
  totalDiscountPence: number;
  finalTotalPence: number;
};

export function priceCartWithRules(
  cart: Cart,
  rules: DiscountRule[]
): DiscountPricing {
  const discounts = rules
    .map((rule) => {
      const result = rule.apply(cart);
      const discountPence = clampDiscount(result.discount, cart.subtotal);

      return {
        ruleId: rule.id,
        description: rule.describe(),
        discountPence,
        explanation: result.explanation
      };
    })
    .filter((discount) => discount.discountPence > 0);

  const totalDiscountPence = Math.min(
    cart.subtotal,
    discounts.reduce((total, discount) => total + discount.discountPence, 0)
  );

  return {
    subtotalPence: cart.subtotal,
    discounts,
    totalDiscountPence,
    finalTotalPence: cart.subtotal - totalDiscountPence
  };
}

function clampDiscount(discount: number, subtotal: number): number {
  if (!Number.isFinite(discount) || !Number.isInteger(discount)) {
    return 0;
  }

  return Math.min(Math.max(discount, 0), subtotal);
}
