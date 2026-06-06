import {
  testResultsToPanelState,
  type RuleTestRunResult
} from "./test-status";

export type RulePipelineStepId =
  | "policy"
  | "codex"
  | "sourceReview"
  | "generatedTests"
  | "activation"
  | "appTests";

export type RulePipelineStepStatus =
  | "PENDING"
  | "RUNNING"
  | "PASSED"
  | "FAILED";

export type RulePipelineStep = {
  id: RulePipelineStepId;
  label: string;
  status: RulePipelineStepStatus;
};

export type RulePipelineState = {
  consoleTitle: string;
  consoleOutput: string;
  steps: RulePipelineStep[];
};

export type RulePipelineEvent =
  | {
      type: "phase";
      phase: string;
      message: string;
    }
  | {
      type: "codex";
      text: string;
    }
  | {
      type: "generatedTestResults";
      results: RuleTestRunResult;
    }
  | {
      type: "appTestStatus";
      status: "RUNNING" | "PASSED" | "FAILED";
      message: string;
      results?: RuleTestRunResult;
    }
  | {
      type: "result";
      result: {
        id: string;
        accepted: boolean;
        status: string;
        testResults: string;
      };
    };

export function createInitialPipelineState(): RulePipelineState {
  return {
    consoleTitle: "Waiting",
    consoleOutput: "Submit a promotion to start the rule-generation pipeline.",
    steps: [
      { id: "policy", label: "Prompt policy review", status: "PENDING" },
      { id: "codex", label: "Codex rule generation", status: "PENDING" },
      { id: "sourceReview", label: "Source validation", status: "PENDING" },
      { id: "generatedTests", label: "Generated rule tests", status: "PENDING" },
      { id: "appTests", label: "Built-in app tests", status: "PENDING" },
      { id: "activation", label: "Rule activation", status: "PENDING" }
    ]
  };
}

export function startRulePipeline(): RulePipelineState {
  return updateStep(createInitialPipelineState(), "policy", "RUNNING", {
    consoleTitle: "Prompt policy review",
    consoleOutput: "Reviewing merchant prompt against discount policy."
  });
}

export function applyRulePipelineEvent(
  state: RulePipelineState,
  event: RulePipelineEvent
): RulePipelineState {
  if (event.type === "phase") {
    return applyPhaseEvent(state, event.phase, event.message);
  }

  if (event.type === "codex") {
    return updateStep(state, "codex", "RUNNING", {
      consoleTitle: "Codex generation",
      consoleOutput: event.text
    });
  }

  if (event.type === "generatedTestResults") {
    const panelState = testResultsToPanelState(event.results);
    return updateStep(
      state,
      "generatedTests",
      panelState.status === "PASSED" ? "PASSED" : "FAILED",
      {
        consoleTitle: "Generated rule tests",
        consoleOutput: formatTestOutput(event.results)
      }
    );
  }

  if (event.type === "appTestStatus") {
    const nextStatus = event.results
      ? testResultsToPanelState(event.results).status
      : event.status;
    return updateStep(state, "appTests", nextStatus, {
      consoleTitle: "Built-in app tests",
      consoleOutput: event.results
        ? formatTestOutput(event.results)
        : event.message
    });
  }

  return updateStep(
    state,
    "activation",
    event.result.accepted ? "PASSED" : "FAILED",
    {
      consoleTitle: "Final result",
      consoleOutput: event.result.testResults
    }
  );
}

function applyPhaseEvent(
  state: RulePipelineState,
  phase: string,
  message: string
): RulePipelineState {
  if (phase === "POLICY_REVIEW") {
    return updateStep(state, "policy", "RUNNING", {
      consoleTitle: "Prompt policy review",
      consoleOutput: message
    });
  }

  if (phase === "GENERATING") {
    return updateStep(
      updateStep(state, "policy", "PASSED"),
      "codex",
      "RUNNING",
      {
        consoleTitle: "Codex generation",
        consoleOutput: message
      }
    );
  }

  if (phase === "SOURCE_REVIEW") {
    return updateStep(
      updateStep(state, "codex", "PASSED"),
      "sourceReview",
      "RUNNING",
      {
        consoleTitle: "Source validation",
        consoleOutput: message
      }
    );
  }

  if (phase === "TESTING") {
    return updateStep(
      updateStep(state, "sourceReview", "PASSED"),
      "generatedTests",
      "RUNNING",
      {
        consoleTitle: "Generated rule tests",
        consoleOutput: message
      }
    );
  }

  if (phase === "ACTIVATING") {
    return updateStep(
      updateStep(state, "appTests", "PASSED"),
      "activation",
      "RUNNING",
      {
        consoleTitle: "Rule activation",
        consoleOutput: message
      }
    );
  }

  if (phase === "ACTIVE") {
    return updateStep(state, "activation", "PASSED", {
      consoleTitle: "Rule activation",
      consoleOutput: message
    });
  }

  if (phase === "APP_TESTING") {
    return updateStep(
      updateStep(state, "generatedTests", "PASSED"),
      "appTests",
      "RUNNING",
      {
        consoleTitle: "Built-in app tests",
        consoleOutput: message
      }
    );
  }

  if (phase === "FAILED") {
    return failRunningStep(state, message);
  }

  return {
    ...state,
    consoleOutput: message
  };
}

function updateStep(
  state: RulePipelineState,
  id: RulePipelineStepId,
  status: RulePipelineStepStatus,
  consoleUpdate?: {
    consoleTitle: string;
    consoleOutput: string;
  }
): RulePipelineState {
  return {
    consoleTitle: consoleUpdate?.consoleTitle ?? state.consoleTitle,
    consoleOutput: consoleUpdate?.consoleOutput ?? state.consoleOutput,
    steps: state.steps.map((step) =>
      step.id === id ? { ...step, status } : step
    )
  };
}

function failRunningStep(
  state: RulePipelineState,
  message: string
): RulePipelineState {
  const runningStep = state.steps.find((step) => step.status === "RUNNING");

  if (!runningStep) {
    return {
      ...state,
      consoleTitle: "Pipeline failed",
      consoleOutput: message
    };
  }

  return updateStep(state, runningStep.id, "FAILED", {
    consoleTitle: runningStep.label,
    consoleOutput: message
  });
}

function formatTestOutput(results: RuleTestRunResult): string {
  return [
    results.command,
    `Exit code: ${results.exitCode}`,
    results.stdout,
    results.stderr
  ]
    .filter(Boolean)
    .join("\n\n");
}
