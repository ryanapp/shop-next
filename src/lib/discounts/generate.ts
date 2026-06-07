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
  GenerationEvent,
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

  try {
    const promptReview = await reviewPromptPolicy(trimmedPrompt, updateStatus);

    if (!promptReview.accepted) {
      const result = await failRule(prisma, rule.id, promptReview.reason);
      updateStatus({ type: "result", result });
      return result;
    }

    const generated = await generateRuleSources({
      prompt: trimmedPrompt,
      slug,
      version,
      modulePath,
      testPath,
      createSources: options.createSources,
      updateStatus
    });

    const sourceReview = await reviewGeneratedSources({
      prompt: trimmedPrompt,
      generated,
      updateStatus
    });

    if (!sourceReview.accepted) {
      const result = await failRule(prisma, rule.id, sourceReview.reason);
      updateStatus({ type: "result", result });
      return result;
    }

    await persistGeneratedSources({
      prisma,
      ruleId: rule.id,
      slug,
      version,
      modulePath,
      testPath,
      generated
    });

    const generatedTestResults = await runGeneratedRuleTests({
      testPath,
      runTests: options.runTests,
      updateStatus
    });

    if (generatedTestResults.exitCode !== 0) {
      return await failVerifiedRule(prisma, rule.id, updateStatus, {
        generated: generatedTestResults
      });
    }

    const appTestResults = await runAppVerificationTests({
      runAppTests: options.runAppTests,
      updateStatus
    });

    if (appTestResults.exitCode !== 0) {
      return await failVerifiedRule(prisma, rule.id, updateStatus, {
        generated: generatedTestResults,
        app: appTestResults
      });
    }

    return await activateVerifiedRule({
      prisma,
      ruleId: rule.id,
      slug,
      generated: generatedTestResults,
      app: appTestResults,
      updateStatus
    });
  } catch (error) {
    const result = await failRule(
      prisma,
      rule.id,
      error instanceof Error ? error.message : "Rule generation failed."
    );
    updateStatus({ type: "result", result });
    return result;
  }
}

async function reviewPromptPolicy(
  prompt: string,
  updateStatus: StatusUpdater
): Promise<{ accepted: boolean; reason: string }> {
  updateStatus({
    type: "phase",
    phase: "POLICY_REVIEW",
    message: "Reviewing merchant prompt against discount policy."
  });

  return await reviewDiscountPolicy(prompt);
}

async function generateRuleSources(input: {
  prompt: string;
  slug: string;
  version: number;
  modulePath: string;
  testPath: string;
  createSources?: GenerateRuleOptions["createSources"];
  updateStatus: StatusUpdater;
}): Promise<GeneratedRuleSources> {
  input.updateStatus({
    type: "phase",
    phase: "GENERATING",
    message: "Generating discount module and Vitest spec with Codex."
  });

  const createSources = input.createSources ?? createSourcesWithCodex;

  return await createSources({
    prompt: input.prompt,
    slug: input.slug,
    version: input.version,
    modulePath: input.modulePath,
    testPath: input.testPath,
    onCodexOutput: (text) => input.updateStatus({ type: "codex", text })
  });
}

async function reviewGeneratedSources(input: {
  prompt: string;
  generated: GeneratedRuleSources;
  updateStatus: StatusUpdater;
}): Promise<{ accepted: boolean; reason: string }> {
  validateGeneratedModuleSource(input.generated.moduleCode);

  input.updateStatus({
    type: "phase",
    phase: "SOURCE_REVIEW",
    message: "Validating generated source and reviewing it against policy."
  });

  const sourceReview = await reviewDiscountPolicy(
    `${input.prompt}\n\n${input.generated.moduleCode}\n\n${input.generated.testCode}`
  );

  return sourceReview;
}

async function persistGeneratedSources(input: {
  prisma: PrismaClient;
  ruleId: string;
  slug: string;
  version: number;
  modulePath: string;
  testPath: string;
  generated: GeneratedRuleSources;
}): Promise<void> {
  const moduleImportPath = `./${input.slug}.v${input.version}`;
  const augmentedTestCode = appendSystemSafetyTest(
    input.generated.testCode,
    moduleImportPath
  );
  validateGeneratedTestSource(augmentedTestCode, moduleImportPath);

  await mkdir(path.join(process.cwd(), generatedRuleDirectory), {
    recursive: true
  });
  await writeFile(path.join(process.cwd(), input.modulePath), input.generated.moduleCode);
  await writeFile(path.join(process.cwd(), input.testPath), augmentedTestCode);

  await markRuleTesting({
    prisma: input.prisma,
    ruleId: input.ruleId,
    moduleCode: input.generated.moduleCode,
    testCode: augmentedTestCode
  });
}

async function runGeneratedRuleTests(input: {
  testPath: string;
  runTests?: GenerateRuleOptions["runTests"];
  updateStatus: StatusUpdater;
}): Promise<TestRunResult> {
  const runTests = input.runTests ?? runVitestForGeneratedRule;

  input.updateStatus({
    type: "phase",
    phase: "TESTING",
    message: "Running generated Vitest spec and system-owned safety tests."
  });

  const results = await runTests(input.testPath);
  input.updateStatus({ type: "generatedTestResults", results });

  return results;
}

async function runAppVerificationTests(input: {
  runAppTests?: GenerateRuleOptions["runAppTests"];
  updateStatus: StatusUpdater;
}): Promise<TestRunResult> {
  input.updateStatus({
    type: "phase",
    phase: "APP_TESTING",
    message: "Running built-in app test suite before activation."
  });
  input.updateStatus({
    type: "appTestStatus",
    status: "RUNNING",
    message: "Running built-in app test suite."
  });

  const runAppTests = input.runAppTests ?? runBuiltInAppTests;
  const results = await runAppTests();

  input.updateStatus({
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

async function activateVerifiedRule(input: {
  prisma: PrismaClient;
  ruleId: string;
  slug: string;
  generated: TestRunResult;
  app: TestRunResult;
  updateStatus: StatusUpdater;
}): Promise<RuleGenerationResult> {
  input.updateStatus({
    type: "phase",
    phase: "ACTIVATING",
    message: "Activating verified rule and disabling older active versions."
  });

  const combinedResults = serializeVerificationResults({
    generated: input.generated,
    app: input.app
  });

  await activateRuleVersion({
    prisma: input.prisma,
    ruleId: input.ruleId,
    slug: input.slug,
    generatedTestResults: JSON.stringify(input.generated, null, 2),
    appTestResults: JSON.stringify(input.app, null, 2),
    testResults: combinedResults
  });

  const result = {
    id: input.ruleId,
    status: RULE_STATUSES.ACTIVE,
    accepted: true,
    testResults: combinedResults
  };

  input.updateStatus({
    type: "phase",
    phase: "ACTIVE",
    message: "Generated rule passed verification and is active."
  });
  input.updateStatus({ type: "result", result });

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
  prisma: PrismaClient,
  id: string,
  updateStatus: (event: GenerationEvent) => void,
  results: VerificationResults
): Promise<RuleGenerationResult> {
  const testResults = serializeVerificationResults(results);

  await markRuleFailed({
    prisma,
    ruleId: id,
    generatedTestResults: results.generated
      ? JSON.stringify(results.generated, null, 2)
      : undefined,
    appTestResults: results.app ? JSON.stringify(results.app, null, 2) : undefined,
    testResults
  });

  const result = {
    id,
    status: RULE_STATUSES.FAILED,
    accepted: false,
    testResults
  };
  updateStatus({
    type: "phase",
    phase: "FAILED",
    message: "Generated rule failed verification."
  });
  updateStatus({ type: "result", result });
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

  await markRuleFailed({
    prisma,
    ruleId: id,
    testResults
  });

  return {
    id,
    status: RULE_STATUSES.FAILED,
    accepted: false,
    testResults
  };
}
