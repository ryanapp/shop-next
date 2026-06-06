# Specification: Authentication And Admin Shell

## Objective

Add demo-friendly authentication and a protected admin shell for shop managers.

## Scope

- Auth.js configured with a Credentials provider using email and password.
- JWT session strategy.
- Bcrypt password verification against seeded Prisma users.
- User `role` surfaced in Auth.js `jwt` and `session` callbacks.
- Middleware protection for admin routes.
- Server-side role check inside the admin page.
- Admin shell page reachable only by users with role `shop-manager`.
- Placeholder form for entering a plain-English promotion.

## Constraints

- Use Credentials provider deliberately for zero external demo setup.
- Do not use Prisma database sessions; Credentials provider is incompatible with the adapter's database sessions.
- Keep the role model compatible with future OAuth/SSO replacement.
- Protect admin access with middleware and a server-side role check.

## Dependencies

- [Project Foundation And Persistence](01-project-foundation-and-persistence.md)

## Out Of Scope

- Wiring the promotion form to rule generation.
- Discount rule lifecycle controls.
- Product or cart authorization.

## Acceptance Criteria

- The seeded `shop-manager` can log in with email and password.
- The seeded `shop-manager` can reach the admin shell.
- The seeded customer can log in but is blocked from the admin shell.
- Unauthenticated visitors are blocked from the admin shell.
- Meaningful Vitest coverage exists for auth/role gating.
- `npm test` passes for this slice.
- `npm run build` is clean for this slice.
