import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Codex } from "@openai/codex-sdk";
import type { PrismaClient } from "@prisma/client";
import ts from "typescript";
import { prisma as defaultPrisma } from "../db";
import { runBuiltInAppTests } from "../verification/app-tests";
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

type VerificationResults = {
  generated?: TestRunResult;
  app?: TestRunResult;
};

export type GenerationEvent =
  | {
      type: "phase";
      phase:
        | "GENERATING"
        | "POLICY_REVIEW"
        | "SOURCE_REVIEW"
        | "TESTING"
        | "APP_TESTING"
        | "ACTIVATING"
        | "ACTIVE"
        | "FAILED";
      message: string;
    }
  | {
      type: "codex";
      text: string;
    }
  | {
      type: "generatedTestResults";
      results: TestRunResult;
    }
  | {
      type: "appTestStatus";
      status: "RUNNING" | "PASSED" | "FAILED";
      message: string;
      results?: TestRunResult;
    }
  | {
      type: "result";
      result: RuleGenerationResult;
    };

export type GenerateRuleOptions = {
  prisma?: PrismaClient;
  slug?: string;
  createSources?: (input: {
    prompt: string;
    slug: string;
    version: number;
    modulePath: string;
    testPath: string;
    onCodexOutput?: (text: string) => void;
  }) => Promise<GeneratedRuleSources>;
  runTests?: (testPath: string) => Promise<TestRunResult>;
  runAppTests?: () => Promise<TestRunResult>;
  onEvent?: (event: GenerationEvent) => void;
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
  const emit = options.onEvent ?? (() => undefined);
  const slug = options.slug ?? slugify(trimmedPrompt);
  const { rule, version, modulePath, testPath } = await createGeneratingRule(
    prisma,
    slug,
    trimmedPrompt
  );

  try {
    emit({
      type: "phase",
      phase: "POLICY_REVIEW",
      message: "Reviewing merchant prompt against discount policy."
    });
    const promptReview = await reviewDiscountPolicy(trimmedPrompt);

    if (!promptReview.accepted) {
      const result = await failRule(prisma, rule.id, promptReview.reason);
      emit({ type: "result", result });
      return result;
    }

    emit({
      type: "phase",
      phase: "GENERATING",
      message: "Generating discount module and Vitest spec with Codex."
    });
    const createSources = options.createSources ?? createSourcesWithCodex;
    const generated = await createSources({
      prompt: trimmedPrompt,
      slug,
      version,
      modulePath,
      testPath,
      onCodexOutput: (text) => emit({ type: "codex", text })
    });

    validateGeneratedModuleSource(generated.moduleCode);

    emit({
      type: "phase",
      phase: "SOURCE_REVIEW",
      message: "Validating generated source and reviewing it against policy."
    });
    const sourceReview = await reviewDiscountPolicy(
      `${trimmedPrompt}\n\n${generated.moduleCode}\n\n${generated.testCode}`
    );

    if (!sourceReview.accepted) {
      const result = await failRule(prisma, rule.id, sourceReview.reason);
      emit({ type: "result", result });
      return result;
    }

    const moduleImportPath = `./${slug}.v${version}`;
    const augmentedTestCode = appendSystemSafetyTest(
      generated.testCode,
      moduleImportPath
    );
    validateGeneratedTestSource(augmentedTestCode, moduleImportPath);

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
    emit({
      type: "phase",
      phase: "TESTING",
      message: "Running generated Vitest spec and system-owned safety tests."
    });
    const generatedTestResults = await runTests(testPath);
    emit({ type: "generatedTestResults", results: generatedTestResults });

    if (generatedTestResults.exitCode !== 0) {
      return await failVerifiedRule(prisma, rule.id, emit, {
        generated: generatedTestResults
      });
    }

    emit({
      type: "phase",
      phase: "APP_TESTING",
      message: "Running built-in app test suite before activation."
    });
    emit({
      type: "appTestStatus",
      status: "RUNNING",
      message: "Running built-in app test suite."
    });
    const runAppTests = options.runAppTests ?? runBuiltInAppTests;
    const appTestResults = await runAppTests();
    emit({
      type: "appTestStatus",
      status: appTestResults.exitCode === 0 ? "PASSED" : "FAILED",
      message:
        appTestResults.exitCode === 0
          ? "Built-in app tests passed."
          : "Built-in app tests failed.",
      results: appTestResults
    });

    if (appTestResults.exitCode !== 0) {
      return await failVerifiedRule(prisma, rule.id, emit, {
        generated: generatedTestResults,
        app: appTestResults
      });
    }

    emit({
      type: "phase",
      phase: "ACTIVATING",
      message: "Activating verified rule and disabling older active versions."
    });
    const combinedResults = serializeVerificationResults({
      generated: generatedTestResults,
      app: appTestResults
    });
    await prisma.$transaction([
      prisma.rule.updateMany({
        where: {
          slug,
          id: { not: rule.id },
          status: RULE_STATUSES.ACTIVE
        },
        data: { status: RULE_STATUSES.DISABLED }
      }),
      prisma.rule.update({
        where: { id: rule.id },
        data: {
          status: RULE_STATUSES.ACTIVE,
          generatedTestResults: JSON.stringify(generatedTestResults, null, 2),
          appTestResults: JSON.stringify(appTestResults, null, 2),
          testResults: combinedResults
        }
      })
    ]);

    const result = {
      id: rule.id,
      status: RULE_STATUSES.ACTIVE,
      accepted: true,
      testResults: combinedResults
    };
    emit({
      type: "phase",
      phase: "ACTIVE",
      message: "Generated rule passed verification and is active."
    });
    emit({ type: "result", result });
    return result;
  } catch (error) {
    const result = await failRule(
      prisma,
      rule.id,
      error instanceof Error ? error.message : "Rule generation failed."
    );
    emit({ type: "result", result });
    return result;
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
  const sourceFile = parseSource("generated-rule.ts", moduleCode);
  const exportedFunctions = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      validateImportDeclaration(statement, {
        allowedModules: new Set(["../contract"]),
        requireTypeOnly: true
      });
    }

    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      hasExportModifier(statement)
    ) {
      exportedFunctions.add(statement.name.text);
    }
  }

  if (!exportedFunctions.has("describe")) {
    throw new Error("Generated module must export describe().");
  }

  if (!exportedFunctions.has("apply")) {
    throw new Error("Generated module must export apply().");
  }

  validateForbiddenSyntax(sourceFile);
}

export function validateGeneratedTestSource(
  testCode: string,
  moduleImportPath: string
): void {
  const sourceFile = parseSource("generated-rule.test.ts", testCode);
  const allowedModules = new Set(["vitest", moduleImportPath]);

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (isAllowedGeneratedTestTypeImport(statement)) {
        continue;
      }

      validateImportDeclaration(statement, {
        allowedModules,
        requireTypeOnly: false
      });
    }
  }

  validateForbiddenSyntax(sourceFile);
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
  onCodexOutput?: (text: string) => void;
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

  const prompt = `Generate a discount module and Vitest spec as JSON only.

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

Do not write files. Do not include markdown fences.`;

  const { events } = await thread.runStreamed(prompt, {
    outputSchema: generatedOutputSchema
  });
  let finalResponse = "";

  for await (const event of events) {
    if (event.type !== "item.completed") {
      continue;
    }

    if (event.item.type === "agent_message") {
      finalResponse = event.item.text;
      input.onCodexOutput?.(event.item.text);
    } else if (event.item.type === "reasoning") {
      input.onCodexOutput?.(event.item.text);
    } else if (event.item.type === "error") {
      input.onCodexOutput?.(event.item.message);
    } else if (event.item.type === "command_execution") {
      input.onCodexOutput?.(event.item.aggregated_output);
    }
  }

  const parsed = JSON.parse(finalResponse) as Partial<GeneratedRuleSources>;

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

    env[key] = key === "PATH" ? sanitizeCodexChildPath(value) : value;
  }

  return env;
}

export function sanitizeCodexChildPath(value: string): string {
  const entries = value
    .split(path.delimiter)
    .filter((entry) => entry.length > 0)
    .filter((entry) => !entry.includes(`${path.sep}.codex${path.sep}tmp${path.sep}arg0`))
    .filter((entry) => !entry.includes(`${path.sep}codex.system${path.sep}`));

  if (entries.length > 0) {
    return entries.join(path.delimiter);
  }

  return ["/usr/local/bin", "/usr/bin", "/bin"].join(path.delimiter);
}

async function runVitestForGeneratedRule(
  testPath: string
): Promise<TestRunResult> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "shop-next-rule-test-"));
  const command = `vitest run --config vitest.generated.config.ts ${testPath}`;
  const startedAt = Date.now();

  try {
    await prepareGeneratedTestWorkspace(tempRoot, testPath);
    const result = await execFileAsync(
      path.join(process.cwd(), "node_modules/.bin/vitest"),
      ["run", "--config", "vitest.generated.config.ts", testPath],
      {
        cwd: tempRoot,
        env: createGeneratedTestEnv(),
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
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
}

async function prepareGeneratedTestWorkspace(
  tempRoot: string,
  testPath: string
): Promise<void> {
  const modulePath = testPath.replace(/\.test\.ts$/, ".ts");
  const contractPath = "src/lib/discounts/contract.ts";

  await mkdir(path.dirname(path.join(tempRoot, testPath)), { recursive: true });
  await cp(path.join(process.cwd(), modulePath), path.join(tempRoot, modulePath));
  await cp(path.join(process.cwd(), testPath), path.join(tempRoot, testPath));
  await cp(
    path.join(process.cwd(), contractPath),
    path.join(tempRoot, contractPath)
  );
  await symlink(
    path.join(process.cwd(), "node_modules"),
    path.join(tempRoot, "node_modules"),
    "dir"
  );
  await writeFile(
    path.join(tempRoot, "vitest.generated.config.ts"),
    `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/lib/discounts/generated/**/*.test.ts"],
    pool: "forks"
  }
});
`
  );
}

function createGeneratedTestEnv(): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;

  for (const key of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP"]) {
    const value = process.env[key];

    if (value) {
      env[key] = value;
    }
  }

  return {
    ...env,
    NODE_ENV: "test"
  };
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

async function failVerifiedRule(
  prisma: PrismaClient,
  id: string,
  emit: (event: GenerationEvent) => void,
  results: VerificationResults
): Promise<RuleGenerationResult> {
  const testResults = serializeVerificationResults(results);

  await prisma.rule.update({
    where: { id },
    data: {
      status: RULE_STATUSES.FAILED,
      generatedTestResults: results.generated
        ? JSON.stringify(results.generated, null, 2)
        : undefined,
      appTestResults: results.app ? JSON.stringify(results.app, null, 2) : undefined,
      testResults
    }
  });

  const result = {
    id,
    status: RULE_STATUSES.FAILED,
    accepted: false,
    testResults
  };
  emit({
    type: "phase",
    phase: "FAILED",
    message: "Generated rule failed verification."
  });
  emit({ type: "result", result });
  return result;
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

async function createGeneratingRule(
  prisma: PrismaClient,
  slug: string,
  source: string
) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const version = await nextVersionForSlug(prisma, slug);
    const modulePath = `${generatedDirectory}/${slug}.v${version}.ts`;
    const testPath = `${generatedDirectory}/${slug}.v${version}.test.ts`;

    try {
      const rule = await prisma.rule.create({
        data: {
          source,
          slug,
          version,
          status: RULE_STATUSES.GENERATING,
          modulePath,
          testPath
        }
      });

      return { rule, version, modulePath, testPath };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Could not reserve a unique generated rule version.");
}

function parseSource(filename: string, source: string): ts.SourceFile {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const diagnostics = (
    sourceFile as ts.SourceFile & {
      parseDiagnostics: readonly ts.Diagnostic[];
    }
  ).parseDiagnostics;

  if (diagnostics.length > 0) {
    throw new Error("Generated source contains invalid TypeScript syntax.");
  }

  return sourceFile;
}

function validateImportDeclaration(
  statement: ts.ImportDeclaration,
  options: {
    allowedModules: Set<string>;
    requireTypeOnly: boolean;
  }
): void {
  const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
    ? statement.moduleSpecifier.text
    : "";

  if (!options.allowedModules.has(moduleName)) {
    throw new Error("Generated source imports a forbidden module.");
  }

  if (options.requireTypeOnly && !statement.importClause?.isTypeOnly) {
    throw new Error("Generated module may only type-import ../contract.");
  }
}

function isAllowedGeneratedTestTypeImport(
  statement: ts.ImportDeclaration
): boolean {
  return (
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === "../contract" &&
    statement.importClause?.isTypeOnly === true
  );
}

function validateForbiddenSyntax(sourceFile: ts.SourceFile): void {
  const forbiddenIdentifiers = new Set([
    "require",
    "process",
    "globalThis",
    "fetch",
    "eval",
    "Function"
  ]);
  const forbiddenModules = new Set([
    "fs",
    "node:fs",
    "fs/promises",
    "node:fs/promises",
    "child_process",
    "node:child_process",
    "http",
    "node:http",
    "https",
    "node:https",
    "net",
    "node:net",
    "dns",
    "node:dns"
  ]);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      throw new Error("Generated source may not use dynamic import.");
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (forbiddenIdentifiers.has(node.expression.text)) {
        throw new Error("Generated source uses a forbidden API.");
      }
    }

    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (
        node.expression.text === "Date" &&
        !isDeterministicDateConstruction(node)
      ) {
        throw new Error("Generated source uses a forbidden API.");
      }

      if (node.expression.text === "Function") {
        throw new Error("Generated source uses a forbidden API.");
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Date" &&
      node.name.text === "now"
    ) {
      throw new Error("Generated source uses a forbidden API.");
    }

    if (ts.isIdentifier(node) && forbiddenModules.has(node.text)) {
      throw new Error("Generated source references a forbidden module.");
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
}

function isDeterministicDateConstruction(node: ts.NewExpression): boolean {
  if (
    node.arguments?.length === 1 &&
    ts.isPropertyAccessExpression(node.arguments[0]) &&
    node.arguments[0].name.text === "placedAt" &&
    ts.isIdentifier(node.arguments[0].expression) &&
    node.arguments[0].expression.text === "cart"
  ) {
    return true;
  }

  return (
    node.arguments?.length === 1 &&
    ts.isCallExpression(node.arguments[0]) &&
    ts.isPropertyAccessExpression(node.arguments[0].expression) &&
    ts.isIdentifier(node.arguments[0].expression.expression) &&
    node.arguments[0].expression.expression.text === "Date" &&
    node.arguments[0].expression.name.text === "UTC"
  );
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    )
  );
}

function serializeVerificationResults(results: VerificationResults): string {
  return JSON.stringify(results, null, 2);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
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
