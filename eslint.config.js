import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist", "**/coverage", "test-results", "playwright-report", "tools"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // The music core runs in Node, in a worker and in tests. It must not reach
    // for the page, the audio stack or the UI framework.
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: ["react", "react-dom", "tone", "zustand"],
        patterns: ["@vsc/web", "@vsc/web/*"],
      }],
      "no-restricted-globals": ["error", "window", "document", "localStorage", "AudioContext"],
      // v1's generator.ts reached 1,273 lines. Split by responsibility instead.
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ...reactHooks.configs.flat.recommended,
    plugins: { ...reactHooks.configs.flat.recommended.plugins, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
);
