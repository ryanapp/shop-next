# Discount Rule Policy

This system only supports discount rules. A valid rule can reduce a cart's subtotal or leave it unchanged.

Reject any merchant prompt or generated source that attempts to:

- increase prices
- raise the cart subtotal or order total
- add a surcharge
- add a fee
- charge extra
- create or rely on a negative discount
- convert an invalid price-increase request into an active no-op rule

Generated rule modules must return `discount` as pence to subtract from the subtotal. For every cart, `discount` must be in the inclusive range `[0, cart.subtotal]`.

## Safety verification is system-owned

The guarantee that a rule can only reduce a cart total — never increase it — is enforced by the system, not by the model. Before any rule is activated, the system appends an independent safety test that it owns (not authored by Codex) and that must pass:

- for representative matching, non-matching, and empty carts, `discount` stays within `[0, cart.subtotal]` and is never negative.

The model's own generated spec proves the rule's intended behaviour. This appended, system-owned test proves the safety invariant regardless of what the model wrote. A rule activates only if both pass.

This matches spec 04 (the pipeline appends a system-owned safety test before activation). As a further runtime defence, the engine treats any negative per-rule discount as zero.
