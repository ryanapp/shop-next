import { unlink } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient, Rule } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma as defaultPrisma } from "../db";
import { generateDiscountRule, type GenerateRuleOptions } from "./generate";
import { isGeneratedRulePath } from "./loader";
import { activateRuleVersion } from "./rule-store";
import { RULE_STATUSES } from "./status";

export type LifecycleOptions = {
  prisma?: PrismaClient;
  revalidate?: boolean;
};

export async function disableRule(
  id: string,
  options: LifecycleOptions = {}
): Promise<Rule> {
  const prisma = options.prisma ?? defaultPrisma;
  const rule = await prisma.rule.update({
    where: { id },
    data: { status: RULE_STATUSES.DISABLED }
  });

  revalidateRuleViews(options);
  return rule;
}

export async function activateRule(
  id: string,
  options: LifecycleOptions = {}
): Promise<Rule> {
  const prisma = options.prisma ?? defaultPrisma;
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id } });

  if (!isVerifiedRule(rule)) {
    throw new Error("Only verified generated rules can be activated.");
  }

  await activateRuleVersion({
    prisma,
    ruleId: id,
    slug: rule.slug
  });

  revalidateRuleViews(options);
  return await prisma.rule.findUniqueOrThrow({ where: { id } });
}

export async function editRule(
  id: string,
  prompt: string,
  options: GenerateRuleOptions & LifecycleOptions = {}
) {
  const prisma = options.prisma ?? defaultPrisma;
  const existing = await prisma.rule.findUniqueOrThrow({ where: { id } });
  const result = await generateDiscountRule(prompt, {
    ...options,
    prisma,
    slug: existing.slug
  });

  revalidateRuleViews(options);
  return result;
}

export async function deleteRule(
  id: string,
  options: LifecycleOptions = {}
): Promise<Rule> {
  const prisma = options.prisma ?? defaultPrisma;
  const rule = await prisma.rule.delete({ where: { id } });

  await Promise.all([
    deleteGeneratedFile(rule.modulePath),
    deleteGeneratedFile(rule.testPath)
  ]);

  revalidateRuleViews(options);
  return rule;
}

export function revalidateRuleViews(options: LifecycleOptions = {}): void {
  if (options.revalidate === false) {
    return;
  }

  revalidatePath("/cart");
  revalidatePath("/admin");
}

function isVerifiedRule(rule: Rule): boolean {
  return (
    Boolean(rule.moduleCode) &&
    Boolean(rule.testCode) &&
    Boolean(rule.modulePath) &&
    Boolean(rule.testPath) &&
    testRunPassed(rule.generatedTestResults) &&
    testRunPassed(rule.appTestResults)
  );
}

function testRunPassed(serializedResults: string | null): boolean {
  if (!serializedResults) {
    return false;
  }

  try {
    const parsed = JSON.parse(serializedResults) as {
      exitCode?: unknown;
    };

    return parsed.exitCode === 0;
  } catch {
    return false;
  }
}

async function deleteGeneratedFile(filePath: string | null): Promise<void> {
  if (!filePath || !isGeneratedRulePath(filePath)) {
    return;
  }

  await unlink(path.resolve(process.cwd(), filePath)).catch((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }

    throw error;
  });
}
