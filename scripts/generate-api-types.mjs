#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import openapiTS, { astToString } from "openapi-typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const skipExport = process.argv.includes("--skip-export");
const schemaPath = path.join(projectRoot, "backend", "openapi.json");
const outputPath = path.join(projectRoot, "frontend", "src", "api", "generated.ts");
const pythonCandidates = process.platform === "win32"
  ? [path.join(projectRoot, ".venv", "Scripts", "python.exe"), "python"]
  : [path.join(projectRoot, ".venv", "bin", "python"), "python3", "python"];
const python = pythonCandidates.find((candidate) => candidate.includes(path.sep)
  ? existsSync(candidate)
  : true);

if (!skipExport) {
  if (!python) throw new Error("Python was not found. Run the setup script first.");
  execFileSync(
    python,
    [path.join(projectRoot, "scripts", "export-openapi.py"), ...(checkOnly ? ["--check"] : [])],
    { cwd: projectRoot, stdio: "inherit" },
  );
}

const ast = await openapiTS(pathToFileURL(schemaPath));
const rendered = `// Generated from backend/openapi.json. Do not edit by hand.\n${astToString(ast)}`;
if (checkOnly) {
  const current = existsSync(outputPath) ? readFileSync(outputPath, "utf8") : "";
  if (current !== rendered) {
    throw new Error("frontend API types are stale; run `pnpm api:types`.");
  }
} else {
  writeFileSync(outputPath, rendered, "utf8");
  process.stdout.write(`${outputPath}\n`);
}
