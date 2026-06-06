import { describe, expect, it, vi } from "vitest";
import {
  applyRulePipelineEvent,
  startRulePipeline
} from "../src/lib/rules/pipeline-status";
import { groupRulesBySlug } from "../src/lib/rules/grouping";
import { testResultsToPanelState } from "../src/lib/rules/test-status";

vi.mock("../src/lib/rules/auth", () => ({
  requireRuleManager: vi.fn(async () => null)
}));

vi.mock("../src/lib/db", () => ({
  prisma: {
    rule: {
      findUniqueOrThrow: vi.fn()
    }
  }
}));

vi.mock("../src/lib/discounts/generate", () => ({
  generateDiscountRule: vi.fn()
}));

vi.mock("../src/lib/discounts/lifecycle", () => ({
  revalidateRuleViews: vi.fn()
}));

vi.mock("../src/lib/verification/app-tests", () => ({
  runBuiltInAppTests: vi.fn()
}));

describe("rules admin hierarchy", () => {
  it("groups versions by slug and shows the active version first", () => {
    const groups = groupRulesBySlug([
      { id: "old", slug: "tea-offer", version: 1, status: "DISABLED" },
      { id: "active", slug: "tea-offer", version: 2, status: "ACTIVE" },
      { id: "draft", slug: "tea-offer", version: 3, status: "FAILED" },
      { id: "bag", slug: "bag-offer", version: 1, status: "DISABLED" }
    ]);

    expect(groups[0].slug).toBe("tea-offer");
    expect(groups[0].activeRule?.id).toBe("active");
    expect(groups[0].versions.map((rule) => rule.id)).toEqual([
      "active",
      "draft",
      "old"
    ]);
  });

  it("uses the newest version first when no version is active", () => {
    const groups = groupRulesBySlug([
      { id: "v1", slug: "inactive", version: 1, status: "DISABLED" },
      { id: "v3", slug: "inactive", version: 3, status: "FAILED" },
      { id: "v2", slug: "inactive", version: 2, status: "DISABLED" }
    ]);

    expect(groups[0].activeRule).toBeNull();
    expect(groups[0].versions.map((rule) => rule.id)).toEqual([
      "v3",
      "v2",
      "v1"
    ]);
  });
});

describe("rules admin test status panels", () => {
  it("shows generated-rule test success details", () => {
    expect(
      testResultsToPanelState({
        command: "npx vitest generated.test.ts",
        exitCode: 0,
        stdout: "passed",
        stderr: "",
        durationMs: 123
      })
    ).toEqual({
      status: "PASSED",
      command: "npx vitest generated.test.ts",
      exitCode: 0,
      output: "passed"
    });
  });

  it("shows built-in app test failure details", () => {
    expect(
      testResultsToPanelState({
        command: "npm test",
        exitCode: 1,
        stdout: "",
        stderr: "failed",
        durationMs: 456
      })
    ).toEqual({
      status: "FAILED",
      command: "npm test",
      exitCode: 1,
      output: "failed"
    });
  });
});

describe("rules admin pipeline status", () => {
  it("advances through generation, source review, tests, activation, and app tests", () => {
    let state = startRulePipeline();

    state = applyRulePipelineEvent(state, {
      type: "phase",
      phase: "GENERATING",
      message: "Generating with Codex."
    });
    state = applyRulePipelineEvent(state, {
      type: "phase",
      phase: "SOURCE_REVIEW",
      message: "Reviewing source."
    });
    state = applyRulePipelineEvent(state, {
      type: "phase",
      phase: "TESTING",
      message: "Running generated tests."
    });
    state = applyRulePipelineEvent(state, {
      type: "generatedTestResults",
      results: {
        command: "npx vitest generated.test.ts",
        exitCode: 0,
        stdout: "passed",
        stderr: "",
        durationMs: 10
      }
    });
    state = applyRulePipelineEvent(state, {
      type: "phase",
      phase: "ACTIVATING",
      message: "Activating."
    });
    state = applyRulePipelineEvent(state, {
      type: "phase",
      phase: "ACTIVE",
      message: "Activated."
    });
    state = applyRulePipelineEvent(state, {
      type: "appTestStatus",
      status: "PASSED",
      message: "App tests passed.",
      results: {
        command: "npm test",
        exitCode: 0,
        stdout: "passed",
        stderr: "",
        durationMs: 20
      }
    });

    expect(state.steps.map((step) => [step.id, step.status])).toEqual([
      ["policy", "PASSED"],
      ["codex", "PASSED"],
      ["sourceReview", "PASSED"],
      ["generatedTests", "PASSED"],
      ["activation", "PASSED"],
      ["appTests", "PASSED"]
    ]);
    expect(state.consoleTitle).toBe("Built-in app tests");
    expect(state.consoleOutput).toContain("npm test");
  });

  it("marks the running step as failed when the pipeline fails", () => {
    const state = applyRulePipelineEvent(startRulePipeline(), {
      type: "phase",
      phase: "FAILED",
      message: "Policy rejected."
    });

    expect(state.steps[0]).toMatchObject({
      id: "policy",
      status: "FAILED"
    });
    expect(state.consoleOutput).toBe("Policy rejected.");
  });
});

describe("rules admin streaming API", () => {
  it("requires a shop-manager session", async () => {
    const { POST } = await import("../src/app/api/rules/stream/route");
    const response = await POST(
      new Request("http://localhost/api/rules/stream", {
        method: "POST",
        body: JSON.stringify({ prompt: "Give 10% off tea" })
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" });
  });
});
