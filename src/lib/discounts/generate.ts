import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db";
import { runBuiltInAppTests } from "../verification/app-tests";
import { createSourcesWithCodex } from "./codex-source-generator";
import { serializeVerificationResults } from "./generation-results";
import type {
  GeneratedRuleSources,
  GenerateRuleOptions,
  RuleGenerationResult,
  StatusUpdater,
  TestRunResult,
  VerificationResults
} from "./generation-types";
import { appendSystemSafetyTest } from "./generated-safety-tests";
import {
  validateGeneratedModuleSource,
  validateGeneratedTestSource
} from "./generated-source-validation";
import { runVitestForGeneratedRule } from "./generated-test-runner";
import { reviewDiscountPolicy } from "./rule-policy";
import {
  activateRuleVersion,
  generatedRuleDirectory,
  markRuleFailed,
  markRuleTesting,
  reserveGeneratingRule
} from "./rule-store";
import { RULE_STATUSES } from "./status";

export type {
  GeneratedRuleSources,
  GenerateRuleOptions,
  GenerationEvent,
  RuleGenerationResult,
  TestRunResult
} from "./generation-types";

type GenerationContext = {
  prisma: PrismaClient;
  ruleId: string;
  prompt: string;
  slug: string;
  version: number;
  modulePath: string;
  testPath: string;
  createSources?: GenerateRuleOptions["createSources"];
  runTests?: GenerateRuleOptions["runTests"];
  runAppTests?: GenerateRuleOptions["runAppTests"];
  emit: StatusUpdater;
};

export async function generateDiscountRule(
  prompt: string,
  options: GenerateRuleOptions = {}
): Promise<RuleGenerationResult> {
  const trimmedPrompt = prompt.trim();

  if (trimmedPrompt.length === 0) {
    throw new Error("Promotion prompt is required.");
  }

  const prisma = options.prisma ?? defaultPrisma;
  const updateStatus = options.onEvent ?? (() => undefined);
  const slug = options.slug ?? slugify(trimmedPrompt);
  const { rule, version, modulePath, testPath } = await reserveGeneratingRule(
    prisma,
    slug,
    trimmedPrompt
  );
  const context: GenerationContext = {
    prisma,
    ruleId: rule.id,
    prompt: trimmedPrompt,
    slug,
    version,
    modulePath,
    testPath,
    createSources: options.createSources,
    runTests: options.runTests,
    runAppTests: options.runAppTests,
    emit: updateStatus
  };

  try {
    const promptReview = await reviewPromptPolicy(context);

    if (!promptReview.accepted) {
      const result = await failRule(context, promptReview.reason);
      context.emit({ type: "result", result });
      return result;
    }

    const generated = await generateRuleSources(context);

    const sourceReview = await reviewGeneratedSources(context, generated);

    if (!sourceReview.accepted) {
      const result = await failRule(context, sourceReview.reason);
      context.emit({ type: "result", result });
      return result;
    }

    await persistGeneratedSources(context, generated);

    const generatedTestResults = await runGeneratedRuleTests(context);

    if (generatedTestResults.exitCode !== 0) {
      return await failVerifiedRule(context, {
        generated: generatedTestResults
      });
    }

    const appTestResults = await runAppVerificationTests(context);

    if (appTestResults.exitCode !== 0) {
      return await failVerifiedRule(context, {
        generated: generatedTestResults,
        app: appTestResults
      });
    }

    return await activateVerifiedRule(context, {
      generated: generatedTestResults,
      app: appTestResults
    });
  } catch (error) {
    const result = await failRule(
      context,
      error instanceof Error ? error.message : "Rule generation failed."
    );
    context.emit({ type: "result", result });
    return result;
  }
}

async function reviewPromptPolicy(
  context: GenerationContext
): Promise<{ accepted: boolean; reason: string }> {
  context.emit({
    type: "phase",
    phase: "POLICY_REVIEW",
    message: "Reviewing merchant prompt against discount policy."
  });

  return await reviewDiscountPolicy(context.prompt);
}

async function generateRuleSources(
  context: GenerationContext
): Promise<GeneratedRuleSources> {
  context.emit({
    type: "phase",
    phase: "GENERATING",
    message: "Generating discount module and Vitest spec with Codex."
  });

  const createSources = context.createSources ?? createSourcesWithCodex;

  return await createSources({
    prompt: context.prompt,
    slug: context.slug,
    version: context.version,
    modulePath: context.modulePath,
    testPath: context.testPath,
    onCodexOutput: (text) => context.emit({ type: "codex", text })
  });
}

async function reviewGeneratedSources(
  context: GenerationContext,
  generated: GeneratedRuleSources
): Promise<{ accepted: boolean; reason: string }> {
  validateGeneratedModuleSource(generated.moduleCode);

  context.emit({
    type: "phase",
    phase: "SOURCE_REVIEW",
    message: "Validating generated source and reviewing it against policy."
  });

  const sourceReview = await reviewDiscountPolicy(
    `${context.prompt}\n\n${generated.moduleCode}\n\n${generated.testCode}`
  );

  return sourceReview;
}

async function persistGeneratedSources(
  context: GenerationContext,
  generated: GeneratedRuleSources
): Promise<void> {
  const moduleImportPath = `./${context.slug}.v${context.version}`;
  const augmentedTestCode = appendSystemSafetyTest(
    generated.testCode,
    moduleImportPath
  );
  validateGeneratedTestSource(augmentedTestCode, moduleImportPath);

  await mkdir(path.join(process.cwd(), generatedRuleDirectory), {
    recursive: true
  });
  await writeFile(path.join(process.cwd(), context.modulePath), generated.moduleCode);
  await writeFile(path.join(process.cwd(), context.testPath), augmentedTestCode);

  await markRuleTesting({
    prisma: context.prisma,
    ruleId: context.ruleId,
    moduleCode: generated.moduleCode,
    testCode: augmentedTestCode
  });
}

async function runGeneratedRuleTests(
  context: GenerationContext
): Promise<TestRunResult> {
  const runTests = context.runTests ?? runVitestForGeneratedRule;

  context.emit({
    type: "phase",
    phase: "TESTING",
    message: "Running generated Vitest spec and system-owned safety tests."
  });

  const results = await runTests(context.testPath);
  context.emit({ type: "generatedTestResults", results });

  return results;
}

async function runAppVerificationTests(
  context: GenerationContext
): Promise<TestRunResult> {
  context.emit({
    type: "phase",
    phase: "APP_TESTING",
    message: "Running built-in app test suite before activation."
  });
  context.emit({
    type: "appTestStatus",
    status: "RUNNING",
    message: "Running built-in app test suite."
  });

  const runAppTests = context.runAppTests ?? runBuiltInAppTests;
  const results = await runAppTests();

  context.emit({
    type: "appTestStatus",
    status: results.exitCode === 0 ? "PASSED" : "FAILED",
    message:
      results.exitCode === 0
        ? "Built-in app tests passed."
        : "Built-in app tests failed.",
    results
  });

  return results;
}

async function activateVerifiedRule(
  context: GenerationContext,
  input: {
    generated: TestRunResult;
    app: TestRunResult;
  }
): Promise<RuleGenerationResult> {
  context.emit({
    type: "phase",
    phase: "ACTIVATING",
    message: "Activating verified rule and disabling older active versions."
  });

  const combinedResults = serializeVerificationResults({
    generated: input.generated,
    app: input.app
  });

  await activateRuleVersion({
    prisma: context.prisma,
    ruleId: context.ruleId,
    slug: context.slug,
    generatedTestResults: JSON.stringify(input.generated, null, 2),
    appTestResults: JSON.stringify(input.app, null, 2),
    testResults: combinedResults
  });

  const result = {
    id: context.ruleId,
    status: RULE_STATUSES.ACTIVE,
    accepted: true,
    testResults: combinedResults
  };

  context.emit({
    type: "phase",
    phase: "ACTIVE",
    message: "Generated rule passed verification and is active."
  });
  context.emit({ type: "result", result });

  return result;
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

async function failVerifiedRule(
  context: GenerationContext,
  results: VerificationResults
): Promise<RuleGenerationResult> {
  const testResults = serializeVerificationResults(results);

  await markRuleFailed({
    prisma: context.prisma,
    ruleId: context.ruleId,
    generatedTestResults: results.generated
      ? JSON.stringify(results.generated, null, 2)
      : undefined,
    appTestResults: results.app ? JSON.stringify(results.app, null, 2) : undefined,
    testResults
  });

  const result = {
    id: context.ruleId,
    status: RULE_STATUSES.FAILED,
    accepted: false,
    testResults
  };
  context.emit({
    type: "phase",
    phase: "FAILED",
    message: "Generated rule failed verification."
  });
  context.emit({ type: "result", result });
  return result;
}

async function failRule(
  context: GenerationContext,
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

  await markRuleFailed({
    prisma: context.prisma,
    ruleId: context.ruleId,
    testResults
  });

  return {
    id: context.ruleId,
    status: RULE_STATUSES.FAILED,
    accepted: false,
    testResults
  };
}
