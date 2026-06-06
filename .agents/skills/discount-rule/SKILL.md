---
name: discount-rule
description: Generate or modify a typed, tested cart discount module from a plain-English promotion, implementing the project's DiscountRule contract plus a Vitest spec. Use whenever turning a merchant's natural-language promo into executable pricing logic — triggers include "promo", "discount", "coupon", "offer", "pricing rule", "% off", "buy X get Y", "spend over". Do NOT use for product catalogue, cart UI, checkout, or auth work.
---

# Discount Rule

Turn a merchant's plain-English promotion into a self-contained, pure, fully-typed discount module plus a Vitest spec that proves it works. The app's rule engine loads and registers the module at runtime, so it must follow this contract exactly.

## Contract (do not change these types)

These types are the source of truth and also live in `src/lib/discounts/contract.ts`. Import them — do not redefine them.

```ts
export interface CartItem {
  sku: string;
  name: string;
  category: string;
  qty: number;
  unitPrice: number; // pence
}

export interface Cart {
  items: CartItem[];
  subtotal: number; // pence; sum of qty * unitPrice
  placedAt: string;  // ISO 8601; use this for any day/time conditions
}

export interface DiscountResult {
  discount: number;    // pence to subtract; 0 if the rule does not apply
  explanation: string; // human-readable; shown in the cart
}

export interface DiscountRule {
  id: string;
  describe(): string;
  apply(cart: Cart): DiscountResult;
}
```

Generate a module that exports exactly these two members. The app attaches the `id` and assembles the full `DiscountRule`, so the generated code must not invent or depend on an id:

```ts
export function describe(): string;
export function apply(cart: Cart): DiscountResult;
```

## Implementation rules

Policy source of truth: `references/policy.md`.

- **Pure and deterministic.** No I/O, no network, no `Date.now()` or `new Date()` — read time only from `cart.placedAt`.
- **No external dependencies.** Standard library only.
- **Money is integer pence.** Never use floats for money.
- `apply` returns `discount` = pence to subtract from the subtotal. Return `{ discount: 0, explanation }` when the promo does not apply.
- **Clamp** `discount` to the range `[0, cart.subtotal]` — never negative, never more than the subtotal.
- Follow the policy in `references/policy.md`: this system only supports discounts, and invalid price-increase requests must be rejected rather than converted into active no-op rules.
- `describe()` returns a one-line human summary of the promo.
- Product words in the merchant prompt, such as "tea", may appear in `sku`, `name`, or `category`. Do not assume the product word is exactly equal to `category`.
- Product-specific rules should use inclusive catalogue-aware matching. For example, a tea promotion must match `sku: "TEA-BLK-003"` and `name: "Breakfast Tea Tin"` even though its category is `pantry`.

## Catalogue examples

Use these seeded products in generated tests when relevant:

- `TEA-BLK-003`, `Breakfast Tea Tin`, category `pantry`, unit price `1250`.
- `BAG-CNV-002`, `Canvas Market Tote`, category `bags`, unit price `2400`.
- `MUG-STN-001`, `Stoneware Mug`, category `home`, unit price `1800`.

## Test conventions (required)

- Co-locate a Vitest spec named `<slug>.test.ts` beside the module.
- Include at minimum:
  1. a **matching** case asserting the exact expected `discount`, and
  2. a **non-matching** case asserting `discount === 0`.
- Cover the empty-cart edge case (`discount: 0`).
- At least two meaningful `expect` assertions; build carts with realistic pence values.
- For product-specific promotions, include a realistic catalogue-shaped matching case where the matching word appears in `sku` or `name` while `category` may be broader. A tea rule that only matches `category === "tea"` is incomplete for this project.

## Steps

1. Parse the promo into (a) the trigger condition(s) and (b) the benefit.
2. Write the module to `src/lib/discounts/generated/<slug>.ts` implementing `describe` and `apply`, importing types from `../contract`.
3. Write the spec to `src/lib/discounts/generated/<slug>.test.ts` following the conventions above.
4. Run `npx vitest run src/lib/discounts/generated/<slug>.test.ts`.
5. If a test fails, fix the **module** (never weaken the test's intent) and rerun. Stop after a passing run or after 2 failed fix attempts.
6. Report the module path, the spec path, and the pass/fail summary.

## Reference skeleton

```ts
import type { Cart, DiscountResult } from "../contract";

export function describe(): string {
  return "…";
}

export function apply(cart: Cart): DiscountResult {
  // 1. guard the non-matching conditions → return { discount: 0, explanation }
  // 2. compute the discount in pence
  // 3. clamp to [0, cart.subtotal]
  const discount = 0;
  return { discount, explanation: "…" };
}
```
