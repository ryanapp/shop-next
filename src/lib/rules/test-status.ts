export type RuleTestRunResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type RuleTestPanelState = {
  status: "PENDING" | "RUNNING" | "PASSED" | "FAILED";
  command?: string;
  exitCode?: number;
  output?: string;
};

export function testResultsToPanelState(
  results: RuleTestRunResult
): RuleTestPanelState {
  return {
    status: results.exitCode === 0 ? "PASSED" : "FAILED",
    command: results.command,
    exitCode: results.exitCode,
    output: [results.stdout, results.stderr].filter(Boolean).join("\n")
  };
}
