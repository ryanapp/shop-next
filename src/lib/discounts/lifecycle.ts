import { unlink } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient, Rule } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma as defaultPrisma } from "../db";
import { generateDiscountRule, type GenerateRuleOptions } from "./generate";
import { isGeneratedRulePath } from "./loader";
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

  await prisma.$transaction([
    prisma.rule.updateMany({
      where: {
        slug: rule.slug,
        id: { not: rule.id },
        status: RULE_STATUSES.ACTIVE
      },
      data: { status: RULE_STATUSES.DISABLED }
    }),
    prisma.rule.update({
      where: { id },
      data: { status: RULE_STATUSES.ACTIVE }
    })
  ]);

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
    Boolean(rule.testResults) &&
    !rule.testResults?.includes('"exitCode": 1')
  );
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
