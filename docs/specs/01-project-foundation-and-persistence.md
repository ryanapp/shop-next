# Specification: Project Foundation And Persistence

## Objective

Create the baseline Next.js, TypeScript, Prisma, SQLite, and Vitest project structure so later storefront, auth, and discount work can build on a running app rather than a blank repository.

## Scope

- Next.js App Router project with TypeScript `strict`.
- Prisma configured for SQLite.
- Core Prisma models for:
  - products
  - carts
  - cart items
  - users with a `role` field
  - rules with `source`, `version`, `status`, and `testResults`
- Seed data for:
  - a small product catalogue
  - one `shop-manager`
  - one customer
- Basic app shell and shared formatting helpers for integer pence display.
- Vitest configured and runnable.

## Constraints

- Follow `AGENTS.md`.
- Money is integer pence everywhere.
- No secrets in the repo; local values belong in `.env`.
- Seeded user passwords must be bcrypt-hashed.

## Out Of Scope

- Product browsing UI beyond a placeholder.
- Cart mutation behavior.
- Auth.js route setup.
- Discount rule generation logic.

## Acceptance Criteria

- `npm install` succeeds.
- Prisma client can be generated.
- The database can be seeded from a clean SQLite file.
- A persistence round-trip test can create/read the seeded or test data.
- `npm test` passes for this slice.
- `npm run build` is clean for this slice.
