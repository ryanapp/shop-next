import ts from "typescript";

export function validateGeneratedModuleSource(moduleCode: string): void {
  const sourceFile = parseSource("generated-rule.ts", moduleCode);
  const exportedFunctions = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      validateImportDeclaration(statement, {
        allowedModules: new Set(["../contract"]),
        requireTypeOnly: true
      });
    }

    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      hasExportModifier(statement)
    ) {
      exportedFunctions.add(statement.name.text);
    }
  }

  if (!exportedFunctions.has("describe")) {
    throw new Error("Generated module must export describe().");
  }

  if (!exportedFunctions.has("apply")) {
    throw new Error("Generated module must export apply().");
  }

  validateForbiddenSyntax(sourceFile);
}

export function validateGeneratedTestSource(
  testCode: string,
  moduleImportPath: string
): void {
  const sourceFile = parseSource("generated-rule.test.ts", testCode);
  const allowedModules = new Set(["vitest", moduleImportPath]);

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (isAllowedGeneratedTestTypeImport(statement)) {
        continue;
      }

      validateImportDeclaration(statement, {
        allowedModules,
        requireTypeOnly: false
      });
    }
  }

  validateForbiddenSyntax(sourceFile);
}

function parseSource(filename: string, source: string): ts.SourceFile {
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const diagnostics = (
    sourceFile as ts.SourceFile & {
      parseDiagnostics: readonly ts.Diagnostic[];
    }
  ).parseDiagnostics;

  if (diagnostics.length > 0) {
    throw new Error("Generated source contains invalid TypeScript syntax.");
  }

  return sourceFile;
}

function validateImportDeclaration(
  statement: ts.ImportDeclaration,
  options: {
    allowedModules: Set<string>;
    requireTypeOnly: boolean;
  }
): void {
  const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
    ? statement.moduleSpecifier.text
    : "";

  if (!options.allowedModules.has(moduleName)) {
    throw new Error("Generated source imports a forbidden module.");
  }

  if (options.requireTypeOnly && !statement.importClause?.isTypeOnly) {
    throw new Error("Generated module may only type-import ../contract.");
  }
}

function isAllowedGeneratedTestTypeImport(
  statement: ts.ImportDeclaration
): boolean {
  return (
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === "../contract" &&
    statement.importClause?.isTypeOnly === true
  );
}

function validateForbiddenSyntax(sourceFile: ts.SourceFile): void {
  const forbiddenIdentifiers = new Set([
    "require",
    "process",
    "globalThis",
    "fetch",
    "eval",
    "Function"
  ]);
  const forbiddenModules = new Set([
    "fs",
    "node:fs",
    "fs/promises",
    "node:fs/promises",
    "child_process",
    "node:child_process",
    "http",
    "node:http",
    "https",
    "node:https",
    "net",
    "node:net",
    "dns",
    "node:dns"
  ]);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      throw new Error("Generated source may not use dynamic import.");
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (forbiddenIdentifiers.has(node.expression.text)) {
        throw new Error("Generated source uses a forbidden API.");
      }
    }

    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      if (
        node.expression.text === "Date" &&
        !isDeterministicDateConstruction(node)
      ) {
        throw new Error("Generated source uses a forbidden API.");
      }

      if (node.expression.text === "Function") {
        throw new Error("Generated source uses a forbidden API.");
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Date" &&
      node.name.text === "now"
    ) {
      throw new Error("Generated source uses a forbidden API.");
    }

    if (ts.isIdentifier(node) && forbiddenModules.has(node.text)) {
      throw new Error("Generated source references a forbidden module.");
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
}

function isDeterministicDateConstruction(node: ts.NewExpression): boolean {
  if (
    node.arguments?.length === 1 &&
    ts.isPropertyAccessExpression(node.arguments[0]) &&
    node.arguments[0].name.text === "placedAt" &&
    ts.isIdentifier(node.arguments[0].expression) &&
    node.arguments[0].expression.text === "cart"
  ) {
    return true;
  }

  return (
    node.arguments?.length === 1 &&
    ts.isCallExpression(node.arguments[0]) &&
    ts.isPropertyAccessExpression(node.arguments[0].expression) &&
    ts.isIdentifier(node.arguments[0].expression.expression) &&
    node.arguments[0].expression.expression.text === "Date" &&
    node.arguments[0].expression.name.text === "UTC"
  );
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    )
  );
}
