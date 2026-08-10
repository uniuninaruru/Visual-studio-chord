import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const backendPort = process.env.APP_PORT ?? "8765";
const frontendPort = Number.parseInt(process.env.MTC_FRONTEND_PORT ?? "5173", 10);

export default defineConfig({
  plugins: [react()],
  // Root by default, so the Docker image and the dev server are unchanged.
  // GitHub Pages serves this repository under /<repo-name>/, and asset URLs are
  // baked in at build time, so that deployment sets VITE_BASE instead.
  base: process.env.VITE_BASE ?? "/",
  define: {
    __BUILD_NODE_VERSION__: JSON.stringify(process.versions.node),
  },
  build: {
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: process.env.MTC_FRONTEND_HOST ?? "127.0.0.1",
    port: Number.isFinite(frontendPort) ? frontendPort : 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    css: true,
    // Generation is the work these tests do, and a lot of them run it across
    // eight styles and eight seeds at thirty-two bars. The heaviest single test
    // takes thirteen seconds on its own, and several sit past five once the
    // workers are contending -- so the default was timing out tests that were
    // computing, not hanging. Well short of a hang, and far enough above the
    // real figures that a genuinely stuck test still fails rather than waits.
    testTimeout: 30_000,
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
