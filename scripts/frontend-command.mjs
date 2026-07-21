import { spawnSync } from "node:child_process";
import process from "node:process";

const scripts = process.argv.slice(2);
if (scripts.length === 0) {
  console.error("Usage: node scripts/frontend-command.mjs <script> [script ...]");
  process.exit(2);
}
if (scripts.some((script) => !/^[A-Za-z0-9:_-]+$/.test(script))) {
  console.error("Frontend script names may contain only letters, numbers, colon, underscore, and dash.");
  process.exit(2);
}

const requested = process.env.MTC_PACKAGE_MANAGER ?? "auto";
const userAgent = process.env.npm_config_user_agent ?? "";

function executable(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function runPackageManager(name, args, stdio) {
  if (process.platform === "win32") {
    // Windows package managers are .cmd shims. Node cannot execute those
    // directly without a command interpreter. All tokens here are validated
    // above or selected from fixed internal values.
    return spawnSync(
      process.env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", [executable(name), ...args].join(" ")],
      { stdio },
    );
  }
  return spawnSync(executable(name), args, { stdio });
}

function isAvailable(name) {
  const result = runPackageManager(name, ["--version"], "ignore");
  return result.status === 0;
}

function selectPackageManager() {
  if (!new Set(["auto", "npm", "pnpm"]).has(requested)) {
    console.error("MTC_PACKAGE_MANAGER must be auto, npm, or pnpm.");
    process.exit(2);
  }
  if (requested !== "auto") {
    if (!isAvailable(requested)) {
      console.error(`Requested package manager '${requested}' was not found.`);
      process.exit(1);
    }
    return requested;
  }
  if (userAgent.startsWith("pnpm/") && isAvailable("pnpm")) return "pnpm";
  if (isAvailable("npm")) return "npm";
  if (isAvailable("pnpm")) return "pnpm";
  console.error("npm or pnpm was not found. Run the platform setup script first.");
  process.exit(1);
}

const manager = selectPackageManager();
for (const script of scripts) {
  const args = manager === "pnpm"
    ? ["--dir", "frontend", script]
    : ["--prefix", "frontend", "run", script];
  const result = runPackageManager(manager, args, "inherit");
  if (result.error) {
    console.error(`${manager} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
