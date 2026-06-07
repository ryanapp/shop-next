import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { TestRunResult } from "./generation-types";

const execFileAsync = promisify(execFile);

export async function runVitestForGeneratedRule(
  testPath: string
): Promise<TestRunResult> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "shop-next-rule-test-"));
  const command = `vitest run --config vitest.generated.config.ts ${testPath}`;
  const startedAt = Date.now();

  try {
    await prepareGeneratedTestWorkspace(tempRoot, testPath);
    const result = await execFileAsync(
      path.join(process.cwd(), "node_modules/.bin/vitest"),
      ["run", "--config", "vitest.generated.config.ts", testPath],
      {
        cwd: tempRoot,
        env: createGeneratedTestEnv(),
        timeout: 20_000
      }
    );

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
  } finally {
    await rm(tempRoot, { force: true, recursive: true });
  }
}

async function prepareGeneratedTestWorkspace(
  tempRoot: string,
  testPath: string
): Promise<void> {
  const modulePath = testPath.replace(/\.test\.ts$/, ".ts");
  const contractPath = "src/lib/discounts/contract.ts";

  await mkdir(path.dirname(path.join(tempRoot, testPath)), { recursive: true });
  await cp(path.join(process.cwd(), modulePath), path.join(tempRoot, modulePath));
  await cp(path.join(process.cwd(), testPath), path.join(tempRoot, testPath));
  await cp(
    path.join(process.cwd(), contractPath),
    path.join(tempRoot, contractPath)
  );
  await symlink(
    path.join(process.cwd(), "node_modules"),
    path.join(tempRoot, "node_modules"),
    "dir"
  );
  await writeFile(
    path.join(tempRoot, "vitest.generated.config.ts"),
    `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/lib/discounts/generated/**/*.test.ts"],
    pool: "forks"
  }
});
`
  );
}

function createGeneratedTestEnv(): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;

  for (const key of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP"]) {
    const value = process.env[key];

    if (value) {
      env[key] = value;
    }
  }

  return {
    ...env,
    NODE_ENV: "test"
  };
}
