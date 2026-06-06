import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatPence } from "../src/lib/money";

const databaseDir = join(tmpdir(), `shop-next-test-${process.pid}`);
const databaseUrl = `file:${join(databaseDir, "test.db")}`;

let prisma: PrismaClient;

describe("project persistence foundation", () => {
  beforeAll(async () => {
    mkdirSync(databaseDir, { recursive: true });
    execFileSync("npx", ["prisma", "db", "push", "--skip-generate"], {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl
      },
      stdio: "pipe"
    });

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl
        }
      }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(databaseDir, { force: true, recursive: true });
  });

  it("creates and reads catalogue, cart, user, and rule records", async () => {
    const product = await prisma.product.create({
      data: {
        sku: "TST-MUG-001",
        name: "Test Mug",
        description: "A mug used by persistence tests.",
        category: "home",
        pricePence: 1800
      }
    });

    const cart = await prisma.cart.create({
      data: {
        items: {
          create: {
            productId: product.id,
            quantity: 2
          }
        }
      },
      include: {
        items: {
          include: {
            product: true
          }
        }
      }
    });

    const passwordHash = await bcrypt.hash("test-password", 12);
    const user = await prisma.user.create({
      data: {
        email: "test-manager@example.com",
        name: "Test Manager",
        role: "shop-manager",
        passwordHash
      }
    });

    const rule = await prisma.rule.create({
      data: {
        source: "Give 10% off mugs",
        slug: "give-10-off-mugs",
        version: 1,
        status: "DRAFT",
        testResults: null
      }
    });

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]?.product.sku).toBe("TST-MUG-001");
    expect(cart.items[0]?.quantity * cart.items[0]?.product.pricePence).toBe(
      3600
    );
    expect(formatPence(product.pricePence)).toBe("£18.00");
    expect(user.role).toBe("shop-manager");
    expect(await bcrypt.compare("test-password", user.passwordHash)).toBe(true);
    expect(rule.status).toBe("DRAFT");
  });
});
