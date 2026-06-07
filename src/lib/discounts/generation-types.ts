import type { PrismaClient } from "@prisma/client";

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

export type VerificationResults = {
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

export type StatusUpdater = (event: GenerationEvent) => void;
