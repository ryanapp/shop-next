# Specification Index

Build the demo in this order. Each specification is deliverable as a unit and should end with `npm test` and `npm run build` passing.

1. [Project Foundation And Persistence](01-project-foundation-and-persistence.md)
2. [Storefront And Cart](02-storefront-and-cart.md)
3. [Authentication And Admin Shell](03-authentication-and-admin-shell.md)
4. [Discount Rule Engine And Codex Pipeline](04-discount-rule-engine-and-codex-pipeline.md)
5. [Rule Lifecycle And Cart Recalculation](05-rule-lifecycle-and-cart-recalculation.md)
6. [Rules Admin UX Improvements](06-rules-admin-ux-improvements.md)

## Final Integration Gate

After all six specifications are complete:

- A visitor can browse seeded products, add to cart, and see a correct total.
- The seeded `shop-manager` can log in with email + password and reach the admin area.
- The seeded customer can log in but is blocked from the admin area.
- The seeded `shop-manager` can generate, enable, disable, edit, and delete discount rules.
- The seeded `shop-manager` can see Codex generation progress, generated-rule test status, built-in app test status, and grouped rule version history in the main admin workspace.
- Runtime Codex-generated discount rules are tested and activated only after verification passes.
- Existing carts recalculate when the active rule set changes.
- `npm test` is green.
- `npm run build` is clean.
