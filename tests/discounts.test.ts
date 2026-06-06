import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildCartSummary } from "../src/lib/cart";
import { cartSummaryToDiscountCart } from "../src/lib/discounts/adapter";
import {
  createCodexChildEnv,
  generateDiscountRule,
  sanitizeCodexChildPath,
  validateGeneratedModuleSource,
  validateGeneratedTestSource,
  type GeneratedRuleSources
} from "../src/lib/discounts/generate";
import { priceCartWithRules } from "../src/lib/discounts/engine";
import { formatStorePlacedAt } from "../src/lib/discounts/pricing";
import { RULE_STATUSES } from "../src/lib/discounts/status";
import { isGeneratedRulePath } from "../src/lib/discounts/loader";

const databaseDir = join(tmpdir(), `shop-next-discounts-${process.pid}`);
const databaseUrl = `file:${join(databaseDir, "test.db")}`;

let prisma: PrismaClient;

describe("discount rule generation pipeline", () => {
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

  it("activates a generated rule only after its generated and safety tests pass", async () => {
    const result = await generateDiscountRule(
      "Give 10% off tea when the basket total is over £30",
      {
        prisma,
        createSources: ({ slug, version }) =>
          Promise.resolve(createTeaDiscountSources(slug, version)),
        runAppTests: async () => passingAppTestResults()
      }
    );

    const rule = await prisma.rule.findUniqueOrThrow({
      where: { id: result.id }
    });

    expect(result.accepted).toBe(true);
    expect(result.status).toBe(RULE_STATUSES.ACTIVE);
    expect(rule.status).toBe(RULE_STATUSES.ACTIVE);
    expect(rule.moduleCode).toContain("export function apply");
    expect(rule.testCode).toContain("system-owned discount safety");
    expect(rule.generatedTestResults).toContain("\"exitCode\": 0");
    expect(rule.appTestResults).toContain("\"exitCode\": 0");
    expect(rule.testResults).toContain("\"generated\"");
    expect(rule.testResults).toContain("\"app\"");
  });

  it("marks a rule failed when source generation throws", async () => {
    const result = await generateDiscountRule("Give 10% off mugs", {
      prisma,
      createSources: async () => {
        throw new Error("Codex generation failed");
      }
    });

    expect(result.accepted).toBe(false);
    expect(result.status).toBe(RULE_STATUSES.FAILED);
    expect(result.testResults).toContain("Codex generation failed");
  });

  it("rejects invalid price-increase prompts before code generation", async () => {
    const result = await generateDiscountRule("Add a £2 surcharge to tea", {
      prisma,
      createSources: async () => {
        throw new Error("should not generate source");
      }
    });

    expect(result.accepted).toBe(false);
    expect(result.status).toBe(RULE_STATUSES.FAILED);
    expect(result.testResults).toContain("Policy rejection");
  });

  it("fails verification when the system safety test catches a negative discount", async () => {
    const result = await generateDiscountRule("Give a risky tea discount", {
      prisma,
      createSources: ({ slug, version }) =>
        Promise.resolve(createNegativeDiscountSources(slug, version)),
      runAppTests: async () => passingAppTestResults()
    });

    const rule = await prisma.rule.findUniqueOrThrow({
      where: { id: result.id }
    });

    expect(result.accepted).toBe(false);
    expect(result.status).toBe(RULE_STATUSES.FAILED);
    expect(rule.testCode).toContain("system-owned discount safety");
    expect(rule.testResults).toContain("toBeGreaterThanOrEqual");
  });

  it("does not activate a generated rule when built-in app tests fail", async () => {
    const result = await generateDiscountRule("Give 10% off bags", {
      prisma,
      createSources: ({ slug, version }) =>
        Promise.resolve(createTeaDiscountSources(slug, version)),
      runAppTests: async () => ({
        command: "npm test",
        exitCode: 1,
        stdout: "",
        stderr: "app tests failed",
        durationMs: 1
      })
    });

    const rule = await prisma.rule.findUniqueOrThrow({
      where: { id: result.id }
    });

    expect(result.accepted).toBe(false);
    expect(result.status).toBe(RULE_STATUSES.FAILED);
    expect(rule.status).toBe(RULE_STATUSES.FAILED);
    expect(rule.generatedTestResults).toContain("\"exitCode\": 0");
    expect(rule.appTestResults).toContain("\"exitCode\": 1");
  });
});

describe("Codex SDK runtime environment", () => {
  it("does not pass outer Codex agent sandbox variables to the child generator", () => {
    process.env.CODEX_SANDBOX = "seatbelt";
    process.env.CODEX_THREAD_ID = "outer-thread";
    process.env.AUTH_SECRET = "test-secret";

    const env = createCodexChildEnv();

    expect(env.CODEX_SANDBOX).toBeUndefined();
    expect(env.CODEX_THREAD_ID).toBeUndefined();
    expect(env.AUTH_SECRET).toBe("test-secret");
  });

  it("removes Codex sandbox path shims from the child generator PATH", () => {
    const sanitized = sanitizeCodexChildPath(
      [
        "/Users/ryan/.codex/tmp/arg0/codex-arg0abc",
        "/usr/local/bin",
        "/var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin",
        "/usr/bin"
      ].join(":")
    );

    expect(sanitized).toBe("/usr/local/bin:/usr/bin");
  });
});

describe("discount cart pricing", () => {
  it("formats rule timestamps in UK store-local time with an offset", () => {
    expect(formatStorePlacedAt(new Date("2026-06-06T12:30:00.000Z"))).toBe(
      "2026-06-06T13:30:00+01:00"
    );
  });

  it("adapts cart summaries and prices carts through rules without hard-coded promos", () => {
    const summary = buildCartSummary([
      {
        quantity: 3,
        product: {
          id: "tea",
          sku: "TEA-BLK-003",
          name: "Pier Breakfast Tea Tin",
          category: "pantry",
          pricePence: 1250
        }
      },
      {
        quantity: 1,
        product: {
          id: "bag",
          sku: "BAG-CNV-002",
          name: "Canvas Beach Market Tote",
          category: "bags",
          pricePence: 2400
        }
      }
    ]);

    const discountCart = cartSummaryToDiscountCart(
      summary,
      "2026-06-06T12:00:00.000Z"
    );
    const pricing = priceCartWithRules(discountCart, [
      {
        id: "rule_tea",
        describe: () => "10% off tea baskets over £30",
        apply: () => ({
          discount: 375,
          explanation: "Tea discount applied"
        })
      },
      {
        id: "rule_bad",
        describe: () => "Invalid negative rule",
        apply: () => ({
          discount: -500,
          explanation: "Should be clamped to zero"
        })
      }
    ]);

    expect(discountCart.subtotal).toBe(6150);
    expect(discountCart.items[0]?.qty).toBe(3);
    expect(pricing.subtotalPence).toBe(6150);
    expect(pricing.totalDiscountPence).toBe(375);
    expect(pricing.finalTotalPence).toBe(5775);
    expect(pricing.discounts).toHaveLength(1);
    expect(isGeneratedRulePath("src/lib/discounts/generated/example.v1.ts")).toBe(
      true
    );
    expect(isGeneratedRulePath("../outside.ts")).toBe(false);
  });
});

describe("generated source validation", () => {
  it("rejects generated modules with non-type imports or forbidden APIs", () => {
    expect(() =>
      validateGeneratedModuleSource(`import { readFileSync } from "fs";

export function describe(): string {
  return "bad";
}

export function apply() {
  return { discount: 0, explanation: readFileSync(".env", "utf8") };
}
`)
    ).toThrow("forbidden module");

    expect(() =>
      validateGeneratedModuleSource(`import { Cart } from "../contract";

export function describe(): string {
  return "bad";
}

export function apply(cart: Cart) {
  return { discount: Date.now() > 0 ? 1 : 0, explanation: "bad" };
}
`)
    ).toThrow("type-import");
  });

  it("rejects generated tests that import outside vitest and the generated module", () => {
    expect(() =>
      validateGeneratedTestSource(`import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { apply } from "./tea.v1";

describe("bad", () => {
  it("reads secrets", () => {
    expect(readFileSync(".env", "utf8")).toBeTruthy();
    expect(apply({ items: [], subtotal: 0, placedAt: "2026-06-06T12:00:00.000Z" }).discount).toBe(0);
  });
});
`, "./tea.v1")
    ).toThrow("forbidden module");
  });

  it("allows deterministic date parsing and test type imports from the contract", () => {
    expect(() =>
      validateGeneratedModuleSource(`import type { Cart, DiscountResult } from "../contract";

const SATURDAY = 6;

export function describe(): string {
  return "£5 off carts placed on Saturdays";
}

function dayOfWeekFromIsoDate(placedAt: string): number | null {
  const match = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(placedAt);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCDay();
}

export function apply(cart: Cart): DiscountResult {
  return {
    discount: dayOfWeekFromIsoDate(cart.placedAt) === SATURDAY ? 500 : 0,
    explanation: "Saturday discount."
  };
}
`)
    ).not.toThrow();

    expect(() =>
      validateGeneratedTestSource(`import { describe, expect, it } from "vitest";
import type { Cart } from "../contract";
import { apply } from "./give-a-5-discount-on-saturdays.v3";

function cart(overrides: Partial<Cart> = {}): Cart {
  return {
    items: [],
    subtotal: 0,
    placedAt: "2026-06-06T10:30:00.000Z",
    ...overrides
  };
}

describe("Saturday discount", () => {
  it("applies on Saturday", () => {
    expect(apply(cart()).discount).toBe(500);
  });
});
`, "./give-a-5-discount-on-saturdays.v3")
    ).not.toThrow();
  });
});

function createTeaDiscountSources(
  slug: string,
  version: number
): GeneratedRuleSources {
  return {
    moduleCode: `import type { Cart, DiscountResult } from "../contract";

export function describe(): string {
  return "10% off tea baskets over £30";
}

export function apply(cart: Cart): DiscountResult {
  const hasTea = cart.items.some((item) =>
    [item.sku, item.name, item.category].some((value) =>
      value.toLowerCase().includes("tea")
    )
  );

  if (!hasTea || cart.subtotal <= 3000) {
    return { discount: 0, explanation: "Tea discount did not apply." };
  }

  const discount = Math.min(Math.floor(cart.subtotal / 10), cart.subtotal);
  return { discount, explanation: "10% tea discount applied." };
}
`,
    testCode: `import { describe, expect, it } from "vitest";
import { apply, describe as describeRule } from "./${slug}.v${version}";

describe("10% off tea over £30", () => {
  it("applies to a catalogue-shaped tea cart over £30", () => {
    const result = apply({
      items: [
        {
          sku: "TEA-BLK-003",
          name: "Breakfast Tea Tin",
          category: "pantry",
          qty: 3,
          unitPrice: 1250
        }
      ],
      subtotal: 3750,
      placedAt: "2026-06-06T12:00:00.000Z"
    });

    expect(describeRule()).toBe("10% off tea baskets over £30");
    expect(result.discount).toBe(375);
  });

  it("does not apply to non-matching or empty carts", () => {
    expect(apply({
      items: [
        {
          sku: "BAG-CNV-002",
          name: "Canvas Market Tote",
          category: "bags",
          qty: 1,
          unitPrice: 2400
        }
      ],
      subtotal: 2400,
      placedAt: "2026-06-06T12:00:00.000Z"
    }).discount).toBe(0);
    expect(apply({
      items: [],
      subtotal: 0,
      placedAt: "2026-06-06T12:00:00.000Z"
    }).discount).toBe(0);
  });
});
`
  };
}

function createNegativeDiscountSources(
  slug: string,
  version: number
): GeneratedRuleSources {
  return {
    moduleCode: `import type { Cart, DiscountResult } from "../contract";

export function describe(): string {
  return "Risky tea discount";
}

export function apply(cart: Cart): DiscountResult {
  const discount = cart.items.length > 0 ? -100 : 0;
  return { discount, explanation: "Unsafe discount." };
}
`,
    testCode: `import { describe, expect, it } from "vitest";
import { apply } from "./${slug}.v${version}";

describe("risky discount", () => {
  it("matches the generated test intent", () => {
    expect(apply({
      items: [],
      subtotal: 0,
      placedAt: "2026-06-06T12:00:00.000Z"
    }).discount).toBe(0);
  });
});
`
  };
}

function passingAppTestResults() {
  return {
    command: "npm test",
    exitCode: 0,
    stdout: "passed",
    stderr: "",
    durationMs: 1
  };
}
