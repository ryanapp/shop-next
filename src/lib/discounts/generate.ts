import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Codex } from "@openai/codex-sdk";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db";
import { RULE_STATUSES } from "./status";

const execFileAsync = promisify(execFile);
const generatedDirectory = "src/lib/discounts/generated";
const skillPath = ".agents/skills/discount-rule/SKILL.md";
const policyPath = ".agents/skills/discount-rule/references/policy.md";

export type GeneratedRuleSources = {
  moduleCode: string;
  testCode: string;
};

export type RuleGenerationResult = {
  id: string;
  status: string;
  accepted: boolean;
  testResults: string;
};

export type TestRunResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type GenerateRuleOptions = {
  prisma?: PrismaClient;
  createSources?: (input: {
    prompt: string;
    slug: string;
    version: number;
    modulePath: string;
    testPath: string;
  }) => Promise<GeneratedRuleSources>;
  runTests?: (testPath: string) => Promise<TestRunResult>;
};

const generatedOutputSchema = {
  type: "object",
  properties: {
    moduleCode: { type: "string" },
    testCode: { type: "string" }
  },
  required: ["moduleCode", "testCode"],
  additionalProperties: false
} as const;

export async function generateDiscountRule(
  prompt: string,
  options: GenerateRuleOptions = {}
): Promise<RuleGenerationResult> {
  const trimmedPrompt = prompt.trim();

  if (trimmedPrompt.length === 0) {
    throw new Error("Promotion prompt is required.");
  }

  const prisma = options.prisma ?? defaultPrisma;
  const slug = slugify(trimmedPrompt);
  const version = await nextVersionForSlug(prisma, slug);
  const modulePath = `${generatedDirectory}/${slug}.v${version}.ts`;
  const testPath = `${generatedDirectory}/${slug}.v${version}.test.ts`;

  const rule = await prisma.rule.create({
    data: {
      source: trimmedPrompt,
      slug,
      version,
      status: RULE_STATUSES.GENERATING,
      modulePath,
      testPath
    }
  });

  try {
    const promptReview = await reviewDiscountPolicy(trimmedPrompt);

    if (!promptReview.accepted) {
      return await failRule(prisma, rule.id, promptReview.reason);
    }

    const createSources = options.createSources ?? createSourcesWithCodex;
    const generated = await createSources({
      prompt: trimmedPrompt,
      slug,
      version,
      modulePath,
      testPath
    });

    validateGeneratedModuleSource(generated.moduleCode);

    const sourceReview = await reviewDiscountPolicy(
      `${trimmedPrompt}\n\n${generated.moduleCode}\n\n${generated.testCode}`
    );

    if (!sourceReview.accepted) {
      return await failRule(prisma, rule.id, sourceReview.reason);
    }

    const augmentedTestCode = appendSystemSafetyTest(
      generated.testCode,
      `./${slug}.v${version}`
    );

    await mkdir(path.join(process.cwd(), generatedDirectory), {
      recursive: true
    });
    await writeFile(path.join(process.cwd(), modulePath), generated.moduleCode);
    await writeFile(path.join(process.cwd(), testPath), augmentedTestCode);

    await prisma.rule.update({
      where: { id: rule.id },
      data: {
        status: RULE_STATUSES.TESTING,
        moduleCode: generated.moduleCode,
        testCode: augmentedTestCode
      }
    });

    const runTests = options.runTests ?? runVitestForGeneratedRule;
    const testResults = await runTests(testPath);
    const serializedResults = JSON.stringify(testResults, null, 2);

    const status =
      testResults.exitCode === 0 ? RULE_STATUSES.ACTIVE : RULE_STATUSES.FAILED;

    await prisma.rule.update({
      where: { id: rule.id },
      data: {
        status,
        testResults: serializedResults
      }
    });

    return {
      id: rule.id,
      status,
      accepted: status === RULE_STATUSES.ACTIVE,
      testResults: serializedResults
    };
  } catch (error) {
    return await failRule(
      prisma,
      rule.id,
      error instanceof Error ? error.message : "Rule generation failed."
    );
  }
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");

  return slug.length > 0 ? slug : "discount-rule";
}

export function validateGeneratedModuleSource(moduleCode: string): void {
  if (!/export\s+function\s+describe\s*\(/.test(moduleCode)) {
    throw new Error("Generated module must export describe().");
  }

  if (!/export\s+function\s+apply\s*\(/.test(moduleCode)) {
    throw new Error("Generated module must export apply().");
  }

  const importStatements = moduleCode.match(/^import\s+.+$/gm) ?? [];

  for (const importStatement of importStatements) {
    if (!/from\s+["']\.\.\/contract["'];?$/.test(importStatement)) {
      throw new Error("Generated module may only import ../contract.");
    }
  }

  const forbiddenPatterns = [
    /\bfetch\s*\(/,
    /\bDate\.now\s*\(/,
    /\bnew\s+Date\s*\(/,
    /\bfs\b/,
    /\bchild_process\b/,
    /\bprocess\b/,
    /\brequire\s*\(/
  ];

  if (forbiddenPatterns.some((pattern) => pattern.test(moduleCode))) {
    throw new Error("Generated module uses a forbidden API.");
  }
}

export function appendSystemSafetyTest(
  generatedTestCode: string,
  moduleImportPath: string
): string {
  return `${generatedTestCode.trim()}

import { apply as __systemApply } from "${moduleImportPath}";

describe("system-owned discount safety", () => {
  const carts = [
    {
      items: [],
      subtotal: 0,
      placedAt: "2026-06-06T12:00:00.000Z"
    },
    {
      items: [
        {
          sku: "TEA-BLK-003",
          name: "Breakfast Tea Tin",
          category: "pantry",
          qty: 2,
          unitPrice: 1250
        }
      ],
      subtotal: 2500,
      placedAt: "2026-06-06T12:00:00.000Z"
    },
    {
      items: [
        {
          sku: "MUG-STN-001",
          name: "Stoneware Mug",
          category: "home",
          qty: 1,
          unitPrice: 1800
        },
        {
          sku: "BAG-CNV-002",
          name: "Canvas Market Tote",
          category: "bags",
          qty: 1,
          unitPrice: 2400
        }
      ],
      subtotal: 4200,
      placedAt: "2026-06-06T12:00:00.000Z"
    }
  ];

  it("keeps every discount within the cart subtotal", () => {
    for (const cart of carts) {
      const result = __systemApply(cart);
      expect(result.discount).toBeGreaterThanOrEqual(0);
      expect(result.discount).toBeLessThanOrEqual(cart.subtotal);
    }
  });
});
`;
}

async function createSourcesWithCodex(input: {
  prompt: string;
  slug: string;
  version: number;
  modulePath: string;
  testPath: string;
}): Promise<GeneratedRuleSources> {
  const [skill, policy] = await Promise.all([
    readFile(path.join(process.cwd(), skillPath), "utf8"),
    readFile(path.join(process.cwd(), policyPath), "utf8")
  ]);

  const codex = new Codex({
    env: createCodexChildEnv()
  });
  const thread = codex.startThread({
    workingDirectory: process.cwd(),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false
  });

  const turn = await thread.run(
    `Generate a discount module and Vitest spec as JSON only.

Merchant promotion:
${input.prompt}

Output filenames:
- module: ${input.modulePath}
- spec: ${input.testPath}

Contract and generation instructions:
${skill}

Policy:
${policy}

Return JSON with exactly:
- moduleCode: TypeScript source for ${input.modulePath}
- testCode: Vitest source for ${input.testPath}

Do not write files. Do not include markdown fences.`,
    { outputSchema: generatedOutputSchema }
  );

  const parsed = JSON.parse(turn.finalResponse) as Partial<GeneratedRuleSources>;

  if (typeof parsed.moduleCode !== "string" || typeof parsed.testCode !== "string") {
    throw new Error("Codex did not return generated module and test source.");
  }

  return {
    moduleCode: parsed.moduleCode,
    testCode: parsed.testCode
  };
}

export function createCodexChildEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }

    if (key.startsWith("CODEX_")) {
      continue;
    }

    env[key] = value;
  }

  return env;
}

async function runVitestForGeneratedRule(
  testPath: string
): Promise<TestRunResult> {
  const command = `npx vitest run --config vitest.generated.config.ts ${testPath}`;
  const startedAt = Date.now();

  try {
    const result = await execFileAsync(
      "npx",
      ["vitest", "run", "--config", "vitest.generated.config.ts", testPath],
      {
        cwd: process.cwd(),
        timeout: 20_000
      }
    );

    return {
      command,
      exitCode: 0,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    const failed = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    return {
      command,
      exitCode: typeof failed.code === "number" ? failed.code : 1,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? failed.message ?? "",
      durationMs: Date.now() - startedAt
    };
  }
}

async function reviewDiscountPolicy(
  text: string
): Promise<{ accepted: boolean; reason: string }> {
  const policy = await readFile(path.join(process.cwd(), policyPath), "utf8");
  const rejectedPattern =
    /\b(increase|raise|surcharge|fee|charge extra|negative discount|price increase)\b/i;

  if (rejectedPattern.test(text)) {
    return {
      accepted: false,
      reason: `Policy rejection: ${policy
        .split("\n")
        .find((line) => line.includes("increase prices")) ?? "invalid discount request"}`
    };
  }

  if (/discount\s*:\s*-\d/.test(text) || /return\s+-\d/.test(text)) {
    return {
      accepted: false,
      reason: "Policy rejection: generated source attempts a negative discount."
    };
  }

  return { accepted: true, reason: "Policy review passed." };
}

async function failRule(
  prisma: PrismaClient,
  id: string,
  reason: string
): Promise<RuleGenerationResult> {
  const testResults = JSON.stringify(
    {
      command: "policy/generation",
      exitCode: 1,
      stdout: "",
      stderr: reason,
      durationMs: 0
    },
    null,
    2
  );

  await prisma.rule.update({
    where: { id },
    data: {
      status: RULE_STATUSES.FAILED,
      testResults
    }
  });

  return {
    id,
    status: RULE_STATUSES.FAILED,
    accepted: false,
    testResults
  };
}

async function nextVersionForSlug(
  prisma: PrismaClient,
  slug: string
): Promise<number> {
  const latest = await prisma.rule.findFirst({
    where: { slug },
    orderBy: { version: "desc" },
    select: { version: true }
  });

  return (latest?.version ?? 0) + 1;
}
