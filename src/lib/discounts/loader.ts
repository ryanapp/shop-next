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
const runtimeTimeoutMs = 100;

type GeneratedContext = vm.Context & {
  exports: {
    describe?: unknown;
    apply?: unknown;
  };
  __cart?: Cart;
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
      loadedRules.push(
        await loadGeneratedRule(rule.id, path.resolve(process.cwd(), rule.modulePath))
      );
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

async function loadGeneratedRule(
  id: string,
  modulePath: string
): Promise<DiscountRule> {
  const context = await loadGeneratedContext(modulePath);

  if (
    typeof context.exports.describe !== "function" ||
    typeof context.exports.apply !== "function"
  ) {
    throw new Error("Generated module exports are invalid.");
  }

  return {
    id,
    describe: () => safeDescribe(context),
    apply: (cart) => safeApply(context, cart)
  };
}

async function loadGeneratedContext(modulePath: string): Promise<GeneratedContext> {
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
  const context = vm.createContext({
    exports: {},
    console: undefined,
    require: undefined,
    process: undefined,
    fetch: undefined,
    globalThis: undefined
  }) as GeneratedContext;

  const script = new vm.Script(transpiled, {
    filename: modulePath
  });
  script.runInContext(context, { timeout: runtimeTimeoutMs });

  return context;
}

function safeDescribe(context: GeneratedContext): string {
  try {
    const value = new vm.Script("exports.describe()", {
      filename: "generated-describe.vm.js"
    }).runInContext(context, { timeout: runtimeTimeoutMs });

    return typeof value === "string" && value.trim().length > 0
      ? value
      : "Generated discount";
  } catch {
    return "Generated discount";
  }
}

function safeApply(context: GeneratedContext, cart: Cart): DiscountResult {
  try {
    context.__cart = cloneCart(cart);
    const value = new vm.Script("exports.apply(__cart)", {
      filename: "generated-apply.vm.js"
    }).runInContext(context, { timeout: runtimeTimeoutMs });

    return normalizeDiscountResult(value);
  } catch {
    return safeNoDiscount("Generated rule failed safely.");
  } finally {
    delete context.__cart;
  }
}

function cloneCart(cart: Cart): Cart {
  return JSON.parse(JSON.stringify(cart)) as Cart;
}

function normalizeDiscountResult(value: unknown): DiscountResult {
  if (typeof value !== "object" || value === null) {
    return safeNoDiscount("Generated rule returned an invalid result.");
  }

  const result = value as {
    discount?: unknown;
    explanation?: unknown;
  };

  const discount = result.discount;
  const explanation = result.explanation;

  if (
    typeof discount !== "number" ||
    !Number.isInteger(discount) ||
    typeof explanation !== "string"
  ) {
    return safeNoDiscount("Generated rule returned an invalid result.");
  }

  if (discount < 0) {
    return safeNoDiscount("Generated rule returned an unsafe discount.");
  }

  return {
    discount,
    explanation
  };
}

function safeNoDiscount(explanation: string): DiscountResult {
  return {
    discount: 0,
    explanation
  };
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
