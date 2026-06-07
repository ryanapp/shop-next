import type { PrismaClient, Rule } from "@prisma/client";
import { RULE_STATUSES } from "./status";

export const generatedRuleDirectory = "src/lib/discounts/generated";

export type GeneratingRuleReservation = {
  rule: Rule;
  version: number;
  modulePath: string;
  testPath: string;
};

export async function reserveGeneratingRule(
  prisma: PrismaClient,
  slug: string,
  source: string
): Promise<GeneratingRuleReservation> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const version = await nextVersionForSlug(prisma, slug);
    const modulePath = `${generatedRuleDirectory}/${slug}.v${version}.ts`;
    const testPath = `${generatedRuleDirectory}/${slug}.v${version}.test.ts`;

    try {
      const rule = await prisma.rule.create({
        data: {
          source,
          slug,
          version,
          status: RULE_STATUSES.GENERATING,
          modulePath,
          testPath
        }
      });

      return { rule, version, modulePath, testPath };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("Could not reserve a unique generated rule version.");
}

export async function markRuleTesting(input: {
  prisma: PrismaClient;
  ruleId: string;
  moduleCode: string;
  testCode: string;
}): Promise<void> {
  await input.prisma.rule.update({
    where: { id: input.ruleId },
    data: {
      status: RULE_STATUSES.TESTING,
      moduleCode: input.moduleCode,
      testCode: input.testCode
    }
  });
}

export async function markRuleFailed(input: {
  prisma: PrismaClient;
  ruleId: string;
  testResults: string;
  generatedTestResults?: string;
  appTestResults?: string;
}): Promise<void> {
  await input.prisma.rule.update({
    where: { id: input.ruleId },
    data: {
      status: RULE_STATUSES.FAILED,
      generatedTestResults: input.generatedTestResults,
      appTestResults: input.appTestResults,
      testResults: input.testResults
    }
  });
}

export async function activateRuleVersion(input: {
  prisma: PrismaClient;
  ruleId: string;
  slug: string;
  generatedTestResults?: string;
  appTestResults?: string;
  testResults?: string;
}): Promise<void> {
  await input.prisma.$transaction([
    input.prisma.rule.updateMany({
      where: {
        slug: input.slug,
        id: { not: input.ruleId },
        status: RULE_STATUSES.ACTIVE
      },
      data: { status: RULE_STATUSES.DISABLED }
    }),
    input.prisma.rule.update({
      where: { id: input.ruleId },
      data: {
        status: RULE_STATUSES.ACTIVE,
        generatedTestResults: input.generatedTestResults,
        appTestResults: input.appTestResults,
        testResults: input.testResults
      }
    })
  ]);
}

async function nextVersionForSlug(
  prisma: PrismaClient,
  slug: string
): Promise<number> {
  const latest = await prisma.rule.findFirst({
    where: { slug },
    orderBy: { version: "desc" },
    select: { version: true }
  });

  return (latest?.version ?? 0) + 1;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
