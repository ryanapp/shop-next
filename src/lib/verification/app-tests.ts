import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TestRunResult } from "../discounts/generate";

const execFileAsync = promisify(execFile);

export async function runBuiltInAppTests(): Promise<TestRunResult> {
  const command = "npm test";
  const startedAt = Date.now();

  try {
    const result = await execFileAsync("npm", ["test"], {
      cwd: process.cwd(),
      timeout: 30_000
    });

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
