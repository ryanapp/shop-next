# Specification: Storefront And Cart

## Objective

Implement the customer-facing shopping flow: browse seeded products, view product detail pages, add/remove items in a cart, and display correct running totals in integer pence.

## Scope

- Storefront product listing page backed by seeded products.
- Product detail pages.
- Cart storage using the Prisma cart models.
- Add-to-cart behavior.
- Remove/decrement item behavior.
- Cart page showing:
  - item rows
  - quantities
  - line totals
  - subtotal
- Shared cart summary helper for future checkout and discount pricing.

## Constraints

- Money remains integer pence until display formatting.
- Do not hard-code promotion or discount logic into the cart.
- Cart behavior should be covered by pure helper tests where possible.

## Dependencies

- [Project Foundation And Persistence](01-project-foundation-and-persistence.md)

## Out Of Scope

- Authentication.
- Checkout/payment.
- Discount application.
- Runtime rule generation.

## Acceptance Criteria

- A visitor can browse seeded products.
- A visitor can open a product page.
- A visitor can add products to a cart.
- A visitor can remove products from a cart.
- Cart totals are correct using integer pence arithmetic.
- Meaningful Vitest coverage exists for cart totals.
- `npm test` passes for this slice.
- `npm run build` is clean for this slice.
