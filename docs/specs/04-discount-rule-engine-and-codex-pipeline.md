# Specification: Discount Rule Engine And Codex Pipeline

## Objective

Implement the core AI-native discount system: a shop manager enters a plain-English promotion, the app uses Codex server-side to generate a typed discount module and Vitest spec, verifies the generated code, and activates the rule only if it passes.

## Scope

- Discount contract in `src/lib/discounts/contract.ts`.
- Discount engine in `src/lib/discounts/engine.ts`.
- Cart-to-discount adapter.
- Active rule loader.
- Cart and checkout pricing through active discount rules.
- Rule data model fields needed for generated source, generated tests, versioning, status, and test output.
- Runtime Codex SDK generation pipeline in `src/lib/discounts/generate.ts`.
- Rule generation API in `src/app/api/rules/**`.
- Admin rule submission and rule history display.

## Discount Contract

`src/lib/discounts/contract.ts` is the source of truth:

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
```

Generated modules export exactly:

```ts
export function describe(): string;
export function apply(cart: Cart): DiscountResult;
```

The app attaches the database rule id when loading generated modules.

## Skill And Policy Source

Generated rule behavior and test conventions live in:

```text
.agents/skills/discount-rule/SKILL.md
.agents/skills/discount-rule/references/policy.md
```

The generator must treat the skill and policy reference as the enduring source for generated rule constraints, including purity, money handling, product matching, catalogue-shaped tests, pass/fail behavior, and invalid price-increase policy.

## Data Model

Extend the `Rule` model so each generated rule can be audited, tested, loaded, and versioned.

Required fields:

- `id`: stable database id.
- `source`: merchant's plain-English promotion.
- `slug`: filesystem-safe rule slug.
- `version`: monotonically increasing integer per slug/source family.
- `status`: string status.
- `modulePath`: relative path to generated module.
- `testPath`: relative path to generated Vitest spec.
- `moduleCode`: generated module source for audit/debug display.
- `testCode`: generated spec source for audit/debug display.
- `testResults`: text or JSON string with command, exit code, stdout, stderr, and duration.
- `createdAt`, `updatedAt`.

Status values:

- `DRAFT`: record created but generation has not completed.
- `GENERATING`: Codex SDK generation is in progress.
- `TESTING`: files have been written and verification is running.
- `ACTIVE`: generated test passed and the rule can be applied.
- `FAILED`: generation, compile, policy, or test verification failed.
- `DISABLED`: rule was previously valid but should not apply.

SQLite does not support Prisma enums in this project, so statuses should be TypeScript constants backed by strings.

## Runtime Files

Generated artifacts live under:

```text
src/lib/discounts/generated/
```

For a slug `summer-tea-10-off` and version `2`, use stable filenames:

```text
src/lib/discounts/generated/summer-tea-10-off.v2.ts
src/lib/discounts/generated/summer-tea-10-off.v2.test.ts
```

The generator owns this directory. Developers should not manually refactor or tidy it.

## Cart And Checkout Integration

Add an adapter from the current cart summary to the discount contract:

- product `sku` maps to `CartItem.sku`.
- product `name` maps to `CartItem.name`.
- product `category` maps to `CartItem.category`.
- cart quantity maps to `CartItem.qty`.
- product `pricePence` maps to `CartItem.unitPrice`.
- `subtotal` is the integer pence sum of `qty * unitPrice`.
- `placedAt` is an ISO timestamp supplied by the server in the store's local timezone, not raw UTC. For this demo the store timezone is `Europe/London`, so a summer basket priced at 1:30pm must look like `2026-06-06T13:30:00+01:00`. Time-window rules generated from merchant prompts such as "between 1pm and 2pm" depend on this local timestamp.

The cart page displays subtotal, applied discount rows, total discount, and final total.

Checkout must use the same calculation path as the cart page so the paid total matches what was shown.

## Active Rule Loading

Add a server-only loader that:

1. Reads rules where `status = "ACTIVE"`.
2. Resolves each `modulePath` under `src/lib/discounts/generated/`.
3. Loads each generated module at runtime without relying on a Next/Webpack dynamic import expression for arbitrary generated paths. A safe implementation may read the generated TypeScript source, transpile it in memory, and evaluate it in a restricted server-only context.
4. Validates that `describe` and `apply` are functions.
5. Wraps the module as a `DiscountRule` using the database `id`.
6. Ignores or marks failed any active rule that cannot be loaded safely.

Rule loading must never use arbitrary paths from user input. Paths must be generated by the server and constrained to the generated directory. A missing or invalid generated file must not crash cart rendering; mark that rule `FAILED` with diagnostic `testResults` and continue pricing with the remaining active rules.

## Generation Pipeline

`src/lib/discounts/generate.ts` implements:

1. Validate the prompt is non-empty.
2. Check the caller is already authorized by the API route.
3. Create a `Rule` record with `DRAFT` or `GENERATING`.
4. Build a constrained Codex SDK prompt that includes:
   - the exact contract
   - the generated rule instructions from the local `discount-rule` skill
   - the requested promotion
   - required output filenames
5. Run an LLM policy review of the merchant prompt using `.agents/skills/discount-rule/references/policy.md`.
6. Fail the rule before code generation if the prompt is not a valid discount request.
7. Run `@openai/codex-sdk` server-side only. The runtime demo path must call Codex/LLM; do not replace it with a deterministic local fallback.
8. Extract or receive the generated module and test source.
9. Validate generated source before writing:
   - no imports except `../contract` in the module
   - required exports exist
   - no obvious forbidden APIs such as `fetch`, `fs`, `child_process`, `Date.now`, `new Date`
10. Run an LLM policy review of the generated module and generated spec.
11. Fail the rule if generated source represents an invalid price-increase rule, including no-op conversions of price-increase requests.
12. Append a system-owned contract safety test to the generated spec that fails if `apply` returns a negative discount or a discount greater than the subtotal for representative carts.
13. Write the module and augmented spec to `src/lib/discounts/generated/`.
14. Mark the rule `TESTING`.
15. Run `npx vitest run --config vitest.generated.config.ts <generated-test-path>` with a timeout. The main Vitest config may intentionally include only `tests/**/*.test.ts`; generated runtime specs need their own config so verification can target `src/lib/discounts/generated/**/*.test.ts` without making normal `npm test` collect runtime artifacts.
16. If tests pass, mark the rule `ACTIVE`.
17. If tests fail or generation fails, mark the rule `FAILED` and save output.

Generation can run synchronously from the admin submit flow for this demo.

### Local Runtime Notes

The Codex SDK wraps the native Codex CLI. In this project, runtime generation only works when the Next dev server process can spawn that CLI normally. If the dev server is itself started inside a restricted Codex/agent sandbox, nested Codex CLI execution may fail before any LLM call with errors like:

```text
failed to initialize in-process app-server client: Operation not permitted
```

For local manual testing, start the Next dev server from a normal shell, or from an approved unsandboxed command. Do not work around this by bypassing Codex generation; the demo requirement is that merchant prompts call the LLM at runtime.

When using `@openai/codex-sdk` from the app, pass a sanitized child environment so the spawned Codex process does not inherit outer-agent variables such as `CODEX_SANDBOX`, `CODEX_THREAD_ID`, or `CODEX_CI`.

## API

All `/api/rules/**` routes require:

- a signed-in user
- `session.user.role === "shop-manager"`
- a route-level server-side role check; middleware alone is not sufficient

### `POST /api/rules`

Creates a generated rule from a prompt.

Request:

```json
{
  "prompt": "Give 10% off tea when the basket total is over £30"
}
```

Success response:

```json
{
  "id": "rule-id",
  "status": "ACTIVE",
  "accepted": true,
  "testResults": "..."
}
```

Failure response:

```json
{
  "id": "rule-id",
  "status": "FAILED",
  "accepted": false,
  "testResults": "..."
}
```

Validation errors return `400`. Unauthorized users return `403`.

### `GET /api/rules`

Returns rule history for the admin UI.

## Admin UI

The admin page becomes a working rule console:

- Plain-English promotion textarea.
- Submit button with pending state.
- Latest generation result with status and test output.
- Rule history table.
- Clear status labels for `ACTIVE`, `FAILED`, `DISABLED`, and in-progress states.
- Rule rows show version numbers.

The UI must not expose raw editing of generated code in this phase.

## Security And Safety

- The generation API is gated by `shop-manager`.
- Codex SDK usage stays server-side.
- No secrets are committed; OpenAI credentials live in `.env`.
- Generated code is verified before activation.
- Generated modules are constrained to the discount contract.
- Generated modules do not receive direct database, request, session, filesystem, or network access.
- Runtime loading is restricted to generated paths produced by the server.
- Runtime loading failure for one active generated rule does not take down cart or checkout pricing.
- Generated rules that return a negative discount or otherwise attempt to increase the basket total fail verification and do not become active.
- As a runtime defence, the engine treats negative per-rule discounts as zero.
- A failed generated rule must not affect cart or checkout totals.

## Dependencies

- [Project Foundation And Persistence](01-project-foundation-and-persistence.md)
- [Storefront And Cart](02-storefront-and-cart.md)
- [Authentication And Admin Shell](03-authentication-and-admin-shell.md)

## Out Of Scope

- Rule enable/disable/edit/delete lifecycle controls; those are covered in [Rule Lifecycle And Cart Recalculation](05-rule-lifecycle-and-cart-recalculation.md).
- Merchant-authored JavaScript editing in the UI.
- External dependencies inside generated discount modules.
- Real payment provider integration.

## Acceptance Criteria

- `contract.ts` exists and exports the complete discount contract.
- Cart and checkout use active discount rules through the shared engine.
- Runtime rule generation uses `@openai/codex-sdk` server-side only.
- Generated modules and specs are written to `src/lib/discounts/generated/`.
- Generated source is validated before testing.
- Prompt and generated-source policy review use the skill policy file.
- Generated specs include app-owned safety tests for negative and over-subtotal discounts.
- Passing generated specs mark rules `ACTIVE`.
- Failing generation, policy, compile, or test verification marks rules `FAILED`.
- Missing or invalid generated files for active rules are marked `FAILED` and do not crash cart rendering.
- Cart pricing supplies `placedAt` in `Europe/London` local time with an explicit offset so generated time-window rules behave as merchants expect.
- The admin UI can submit a prompt and show rule status/test output.
- Meaningful tests cover adapter, engine, loader, API, generation success, generation failure, policy rejection, negative-discount safety, generated-rule loading failure, and store-local timestamp formatting.
- `npm test` passes.
- `npm run build` is clean.
