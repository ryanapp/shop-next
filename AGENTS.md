# AGENTS.md

## Project

A from-scratch e-commerce demo. The headline feature: a merchant types a plain-English promotion, and the app uses Codex programmatically at runtime to generate a typed, tested discount rule, runs its tests in a sandbox, and registers it only if the tests pass.

## Stack

- Next.js (App Router, TypeScript, `strict`)
- Auth.js — single provider; a `shop-manager` role gates rule creation
- Prisma + SQLite — products, carts, and generated rules (code + version + test results)
- Vitest — all tests
- `@openai/codex-sdk` — the runtime rule-generation loop (server-side only)

## Commands

- Install: `npm install`
- Dev: `npm run dev`
- Test: `npm test` (Vitest)
- Build: `npm run build`
- Lint: `npm run lint`

## Code map

Standing facts about key paths, independent of any task:

- **Runtime rule pipeline** — `src/lib/discounts/contract.ts` (the `DiscountRule` contract; source of truth), `src/lib/discounts/engine.ts` (applies active rules to a cart), `src/lib/discounts/generate.ts` (the Codex SDK loop: generate → test → register), and `src/app/api/rules/**` (the rule-generation API). This is the product's core: the contract drives everything downstream, so changes here are high-impact — keep them deliberate and reviewed.
- **Runtime artifacts** — `src/lib/discounts/generated/**` is written by the running app at runtime (the SDK loop output). Treat it as generated output, not source: never modify, refactor, or "tidy" it.

## Conventions

- TypeScript `strict`; no `any` (especially in the discount engine).
- Money is integer **pence** everywhere. No floats for money.
- Discounts come **only** from modules implementing the contract — never hard-code promo logic into the cart or checkout.
- Small modules, clear boundaries, prefer pure functions.

## Discount generation

When asked to produce discount logic, use the **discount-rule** skill and follow its contract and test conventions exactly. Generated rules live in `src/lib/discounts/generated/` and import types from `../contract`.

## Testing

- Every feature ships with at least one meaningful Vitest test.
- `npm test` stays green and `npm run build` stays clean on every change.

## Don'ts

- No secrets in the repo. Use `.env`; commit only `.env.example`.
- No new heavy dependencies without a clear reason.
- Never weaken or delete a test just to make it pass.