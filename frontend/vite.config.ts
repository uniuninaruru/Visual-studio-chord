import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const backendPort = process.env.APP_PORT ?? "8765";
const frontendPort = Number.parseInt(process.env.MTC_FRONTEND_PORT ?? "5173", 10);

export default defineConfig({
  plugins: [react()],
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
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
