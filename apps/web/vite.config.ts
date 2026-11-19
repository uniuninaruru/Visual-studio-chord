import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));
const evalDir = resolve(here, "../../eval");
const resultsDir = resolve(evalDir, "results");

/**
 * Lets the listening page write its result straight into eval/results while
 * running locally. The published build has no server, so it downloads instead.
 */
function listeningResults(): Plugin {
  return {
    name: "vsc-listening-results",
    apply: "serve",
    configureServer(server) {
      // eval/ sits outside this app, so new renders would otherwise go unseen until a restart.
      server.watcher.add(resolve(evalDir, "renders"));
      server.middlewares.use("/__eval/results", (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end();
          return;
        }
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > 1_000_000) request.destroy();
        });
        request.on("end", () => {
          try {
            const result = JSON.parse(body) as { format?: unknown };
            if (result.format !== "vsc-listening/1") throw new Error("unexpected format");
            mkdirSync(resultsDir, { recursive: true });
            const name = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
            writeFileSync(join(resultsDir, name), `${JSON.stringify(result, null, 2)}\n`);
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ file: `eval/results/${name}` }));
          } catch {
            response.statusCode = 400;
            response.end();
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), listeningResults()],
  // GitHub Pages serves the site under /<repository>/.
  base: process.env.VITE_BASE ?? "/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(here, "index.html"),
        listen: resolve(here, "listen/index.html"),
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  test: {
    name: "web",
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
