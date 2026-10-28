import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const root = path.dirname(fileURLToPath(import.meta.url));
// eslint-config-next 15 ships legacy (eslintrc) configs; FlatCompat adapts them to flat config
const compat = new FlatCompat({ baseDirectory: root });

const config = [
  {
    ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "data/**", "apps/web/next-env.d.ts"],
  },
  ...compat.config({
    extends: ["next/core-web-vitals", "next/typescript"],
    settings: { next: { rootDir: "apps/web/" } },
  }),
  {
    rules: {
      // The code base predates linting: these are warnings until each package is cleaned up
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "prefer-const": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "react/no-unescaped-entities": "warn",
      "@next/next/no-html-link-for-pages": "off",
      // `declare global { var x }` needs var
      "no-var": "warn",
    },
  },
  {
    // Node packages and scripts: no React or Next page rules
    files: ["packages/**/*.ts", "scripts/**/*"],
    rules: { "@next/next/no-assign-module-variable": "off" },
  },
];

export default config;
