import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCartSummary } from "../src/lib/cart";
import {
  activateRule,
  deleteRule,
  disableRule,
  editRule
} from "../src/lib/discounts/lifecycle";
import { priceCartWithRules } from "../src/lib/discounts/engine";
import { cartSummaryToDiscountCart } from "../src/lib/discounts/adapter";
import { RULE_STATUSES } from "../src/lib/discounts/status";

const databaseDir = join(tmpdir(), `shop-next-lifecycle-${process.pid}`);
const databaseUrl = `file:${join(databaseDir, "test.db")}`;

let prisma: PrismaClient;

describe("rule lifecycle", () => {
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

  it("disables and reactivates a verified rule", async () => {
    const rule = await createVerifiedRule("lifecycle-disable", 1, "ACTIVE");

    const disabled = await disableRule(rule.id, {
      prisma,
      revalidate: false
    });
    expect(disabled.status).toBe(RULE_STATUSES.DISABLED);

    const active = await activateRule(rule.id, {
      prisma,
      revalidate: false
    });
    expect(active.status).toBe(RULE_STATUSES.ACTIVE);
  });

  it("keeps only one active version in a slug family", async () => {
    const older = await createVerifiedRule("single-active", 1, "ACTIVE");
    const newer = await createVerifiedRule("single-active", 2, "DISABLED");

    await activateRule(newer.id, { prisma, revalidate: false });

    const rules = await prisma.rule.findMany({
      where: { slug: "single-active" },
      orderBy: { version: "asc" }
    });

    expect(rules.map((rule) => [rule.version, rule.status])).toEqual([
      [1, RULE_STATUSES.DISABLED],
      [2, RULE_STATUSES.ACTIVE]
    ]);
    expect(older.id).not.toBe(newer.id);
  });

  it("rejects manual activation without complete passing verification results", async () => {
    const missingApp = await prisma.rule.create({
      data: {
        source: "missing app verification",
        slug: "missing-app-verification",
        version: 1,
        status: RULE_STATUSES.DISABLED,
        modulePath: "src/lib/discounts/generated/missing-app-verification.v1.ts",
        testPath:
          "src/lib/discounts/generated/missing-app-verification.v1.test.ts",
        moduleCode: "export function describe() { return 'x'; }",
        testCode: "test code",
        generatedTestResults: JSON.stringify({ exitCode: 0 }),
        testResults: JSON.stringify({ exitCode: 0 })
      }
    });
    const failedGenerated = await prisma.rule.create({
      data: {
        source: "failed generated verification",
        slug: "failed-generated-verification",
        version: 1,
        status: RULE_STATUSES.DISABLED,
        modulePath:
          "src/lib/discounts/generated/failed-generated-verification.v1.ts",
        testPath:
          "src/lib/discounts/generated/failed-generated-verification.v1.test.ts",
        moduleCode: "export function describe() { return 'x'; }",
        testCode: "test code",
        generatedTestResults: JSON.stringify({ exitCode: 2 }),
        appTestResults: JSON.stringify({ exitCode: 0 }),
        testResults: JSON.stringify({ exitCode: 0 })
      }
    });

    await expect(
      activateRule(missingApp.id, { prisma, revalidate: false })
    ).rejects.toThrow("Only verified");
    await expect(
      activateRule(failedGenerated.id, { prisma, revalidate: false })
    ).rejects.toThrow("Only verified");
  });

  it("failed edits do not disable the current active version", async () => {
    const current = await createVerifiedRule("failed-edit", 1, "ACTIVE");

    const result = await editRule(current.id, "Give 10% off tea", {
      prisma,
      revalidate: false,
      createSources: async () => {
        throw new Error("edit generation failed");
      }
    });
    const reloadedCurrent = await prisma.rule.findUniqueOrThrow({
      where: { id: current.id }
    });

    expect(result.status).toBe(RULE_STATUSES.FAILED);
    expect(reloadedCurrent.status).toBe(RULE_STATUSES.ACTIVE);
  });

  it("deletes a rule and its generated files when they are under generated/", async () => {
    const modulePath = "src/lib/discounts/generated/lifecycle-delete.v1.ts";
    const testPath = "src/lib/discounts/generated/lifecycle-delete.v1.test.ts";
    const rule = await createVerifiedRule("lifecycle-delete", 1, "ACTIVE", {
      modulePath,
      testPath
    });

    mkdirSync("src/lib/discounts/generated", { recursive: true });
    writeFileSync(modulePath, "export function describe() { return 'x'; }");
    writeFileSync(testPath, "import { expect, it } from 'vitest'; it('x', () => expect(1).toBe(1));");

    await deleteRule(rule.id, { prisma, revalidate: false });

    await expect(
      prisma.rule.findUnique({ where: { id: rule.id } })
    ).resolves.toBeNull();
    expect(existsSync(modulePath)).toBe(false);
    expect(existsSync(testPath)).toBe(false);
  });

  it("existing carts recalculate through the active rule set after status changes", () => {
    const summary = buildCartSummary([
      {
        quantity: 2,
        product: {
          id: "tea",
          sku: "TEA-BLK-003",
          name: "Pier Breakfast Tea Tin",
          category: "pantry",
          pricePence: 1250
        }
      }
    ]);
    const cart = cartSummaryToDiscountCart(
      summary,
      "2026-06-06T13:30:00+01:00"
    );
    const activePricing = priceCartWithRules(cart, [
      {
        id: "rule",
        describe: () => "£1 off",
        apply: () => ({ discount: 100, explanation: "Applied" })
      }
    ]);
    const disabledPricing = priceCartWithRules(cart, []);

    expect(activePricing.finalTotalPence).toBe(2400);
    expect(disabledPricing.finalTotalPence).toBe(2500);
  });
});

async function createVerifiedRule(
  slug: string,
  version: number,
  status: string,
  paths: {
    modulePath?: string;
    testPath?: string;
  } = {}
) {
  return await prisma.rule.create({
    data: {
      source: `${slug} source`,
      slug,
      version,
      status,
      modulePath:
        paths.modulePath ?? `src/lib/discounts/generated/${slug}.v${version}.ts`,
      testPath:
        paths.testPath ??
        `src/lib/discounts/generated/${slug}.v${version}.test.ts`,
      moduleCode: "export function describe() { return 'x'; }",
      testCode: "test code",
      generatedTestResults: JSON.stringify({ exitCode: 0 }),
      appTestResults: JSON.stringify({ exitCode: 0 }),
      testResults: JSON.stringify({
        generated: { exitCode: 0 },
        app: { exitCode: 0 }
      })
    }
  });
}
