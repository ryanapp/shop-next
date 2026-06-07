import { readFile } from "node:fs/promises";
import path from "node:path";

const policyPath = ".agents/skills/discount-rule/references/policy.md";

export async function reviewDiscountPolicy(
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
