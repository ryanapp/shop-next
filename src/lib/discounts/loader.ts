import path from "node:path";
import vm from "node:vm";
import { access, readFile } from "node:fs/promises";
import ts from "typescript";
import { prisma } from "../db";
import type { Cart, DiscountResult, DiscountRule } from "./contract";
import { RULE_STATUSES } from "./status";

const generatedDirectory = path.join(
  process.cwd(),
  "src/lib/discounts/generated"
);

type GeneratedModule = {
  describe?: unknown;
  apply?: unknown;
};

export function isGeneratedRulePath(modulePath: string): boolean {
  const absolutePath = path.resolve(process.cwd(), modulePath);
  return (
    absolutePath.startsWith(`${generatedDirectory}${path.sep}`) &&
    absolutePath.endsWith(".ts")
  );
}

export async function loadActiveDiscountRules(): Promise<DiscountRule[]> {
  const rules = await prisma.rule.findMany({
    where: { status: RULE_STATUSES.ACTIVE },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });

  const loadedRules: DiscountRule[] = [];

  for (const rule of rules) {
    if (!rule.modulePath || !isGeneratedRulePath(rule.modulePath)) {
      continue;
    }

    try {
      const generatedModule = await loadGeneratedModule(
        path.resolve(process.cwd(), rule.modulePath)
      );

      if (
        typeof generatedModule.describe !== "function" ||
        typeof generatedModule.apply !== "function"
      ) {
        await markRuleLoadFailed(rule.id, "Generated module exports are invalid.");
        continue;
      }

      loadedRules.push({
        id: rule.id,
        describe: generatedModule.describe as () => string,
        apply: generatedModule.apply as (cart: Cart) => DiscountResult
      });
    } catch (error) {
      await markRuleLoadFailed(
        rule.id,
        error instanceof Error ? error.message : "Generated module failed to load."
      );
      continue;
    }
  }

  return loadedRules;
}

async function loadGeneratedModule(modulePath: string): Promise<GeneratedModule> {
  await access(modulePath);
  const source = await readFile(modulePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      strict: true,
      esModuleInterop: true
    }
  }).outputText;
  const exports: GeneratedModule = {};
  const context = vm.createContext({
    exports,
    console: undefined,
    require: undefined,
    process: undefined,
    fetch: undefined
  });

  const script = new vm.Script(transpiled, {
    filename: modulePath
  });
  script.runInContext(context, { timeout: 1000 });

  return exports;
}

async function markRuleLoadFailed(id: string, reason: string): Promise<void> {
  await prisma.rule.update({
    where: { id },
    data: {
      status: RULE_STATUSES.FAILED,
      testResults: JSON.stringify(
        {
          command: "load active generated rule",
          exitCode: 1,
          stdout: "",
          stderr: reason,
          durationMs: 0
        },
        null,
        2
      )
    }
  });
}
