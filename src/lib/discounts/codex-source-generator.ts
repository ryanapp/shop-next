import { readFile } from "node:fs/promises";
import path from "node:path";
import { Codex } from "@openai/codex-sdk";
import type { GeneratedRuleSources } from "./generation-types";

const skillPath = ".agents/skills/discount-rule/SKILL.md";
const policyPath = ".agents/skills/discount-rule/references/policy.md";

const generatedOutputSchema = {
  type: "object",
  properties: {
    moduleCode: { type: "string" },
    testCode: { type: "string" }
  },
  required: ["moduleCode", "testCode"],
  additionalProperties: false
} as const;

export async function createSourcesWithCodex(input: {
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
  const thread = codex.startThread(createCodexThreadOptions());

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

export function createCodexThreadOptions() {
  return {
    workingDirectory: process.cwd(),
    sandboxMode: "read-only" as const,
    approvalPolicy: "never" as const,
    networkAccessEnabled: false,
    skipGitRepoCheck: true
  };
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
