# Shop Next

A small e-commerce demo for trying runtime-generated cart promotions.

The storefront sells a few seeded products, supports a cookie-backed basket, and has a manager-only admin console where a plain-English promotion can be turned into an active discount rule after verification.

## Getting Started

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Set a real `AUTH_SECRET` in `.env`. If you plan to use the rule-generation console, also make sure your Codex/OpenAI credentials are available in the shell that starts the app.

Create and seed the local SQLite database:

```bash
npm run prisma:push
npm run prisma:seed
```

Start the app:

```bash
WATCHPACK_POLLING=true npm run dev
```

Open `http://localhost:3000`.

## Demo Login

The seed script creates local-only demo users:

```text
manager@example.com / manager-password
customer@example.com / customer-password
```

Only the manager account can use the promotion console at `/admin`.

## Rule Generation Notes

Runtime rule generation launches Codex from the Next.js server process. If you are running this project from inside another sandboxed agent/tool process, start the dev server outside that sandbox; otherwise nested Codex startup can fail before generation begins.

Generated discount files are runtime artifacts under `src/lib/discounts/generated/` and are ignored by Git.

## Useful Commands

```bash
npm test
npm run lint
npm run build
npm run prisma:push
npm run prisma:seed
```

