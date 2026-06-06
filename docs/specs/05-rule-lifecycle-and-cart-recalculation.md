# Specification: Rule Lifecycle And Cart Recalculation

## Objective

Add complete merchant lifecycle management for generated discount rules: enable, disable, edit as a new version, delete, and recalculate existing carts when the active rule set changes.

## Scope

- Enable/reactivate verified rules.
- Disable active rules.
- Edit an existing rule by generating a new version.
- Delete rules from history and active use.
- Ensure only one version of the same rule family is active at once.
- Revalidate cart/admin views when rule status changes.
- Admin UI controls for enable, disable, edit, and delete.

## Versioning Rules

- Creating a new promotion starts at version `1` for its slug.
- Creating another generated rule in an existing slug family uses `version = previous max version + 1`.
- Editing an existing rule never mutates the existing rule's generated module, generated spec, or test output.
- Editing creates a new `Rule` row with the same slug family and `version = previous max version + 1`.
- If the edited version passes verification, it becomes `ACTIVE`.
- At most one version in a slug family may be `ACTIVE` at once.
- Activating a version or accepting a newly generated version atomically sets other active versions in the same slug family to `DISABLED`.
- Different slug families may have active rules at the same time and can stack through the engine.
- Failed edited versions remain visible as `FAILED` and do not change the currently active version.

## Delete Semantics

Deleting a rule removes its database row.

If the deleted row points to generated module/spec files under `src/lib/discounts/generated/`, those runtime files are deleted as part of the operation. Missing generated files do not block deletion.

Deleting an active rule removes it from the active rule set and invalidates cart pricing views.

## API

All routes require:

- a signed-in user
- `session.user.role === "shop-manager"`
- a route-level server-side role check; middleware alone is not sufficient

### `POST /api/rules/:id/disable`

Disables a rule. Disabled rules remain in history and do not apply to baskets.

### `POST /api/rules/:id/activate`

Reactivates a previously verified rule. Only rules with generated module code and passing test output may be activated.

Activating a rule disables other active versions in the same slug family so only one version of a rule is active.

### `POST /api/rules/:id/edit`

Creates a new version from an existing rule and a revised prompt. The existing rule is not modified. The new version goes through the same generate, validate, test, policy, and activate pipeline as a newly submitted rule.

Request:

```json
{
  "prompt": "Give 15% off tea when the basket total is over £40"
}
```

Success and failure responses use the same shape as `POST /api/rules`.

### `POST /api/rules/:id/delete`

Deletes a rule from history and active use. If generated module/spec paths are under `src/lib/discounts/generated/`, those files are deleted.

## Cart Recalculation

Rule creation, activation, disabling, successful edits, and deletion must invalidate cart pricing views so baskets with existing items are recalculated against the current active rule set on the next render/navigation.

At minimum, rule lifecycle mutations revalidate:

- `/cart`
- `/admin`

Checkout must continue to calculate totals through the same active-rule pricing path used by the cart page.

## Admin UI

The rule console supports:

- Enable controls for verified disabled rules.
- Disable controls for active rules.
- Edit controls that prefill the existing prompt and submit a new generated version.
- Delete controls for removing rules from history and active use.
- Version labels so merchants can distinguish edited generations.
- Clear status labels for `ACTIVE`, `FAILED`, `DISABLED`, and in-progress states.
- Pending and result messages for lifecycle actions.

The UI must not expose raw editing of generated code.

## Dependencies

- [Discount Rule Engine And Codex Pipeline](04-discount-rule-engine-and-codex-pipeline.md)

## Out Of Scope

- Merchant-authored JavaScript editing.
- Bulk rule operations.
- Scheduling rules by calendar date.
- Choosing whether different active rule families stack. Different active families stack by default in this demo.

## Acceptance Criteria

- A shop manager can disable an active rule.
- A shop manager can activate a verified disabled rule.
- A shop manager can edit a rule and create a new version.
- A failed edit does not disable the currently active version.
- Activating or accepting a version leaves at most one active version in that slug family.
- A shop manager can delete a rule.
- Deleting a rule removes generated module/spec files when those files are under `src/lib/discounts/generated/`.
- Rule lifecycle mutations revalidate cart/admin views.
- Existing carts recalculate when the active rule set changes.
- Meaningful tests cover lifecycle actions, API authorization, generated-file cleanup, and the single-active-version invariant.
- `npm test` passes.
- `npm run build` is clean.
