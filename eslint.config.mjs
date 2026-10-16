// ESLint flat config — intentionally a small, high-signal rule set.
//
// Only rules that catch real bugs are enabled (unawaited/misused promises,
// unused variables). The promise rules are errors (backlog cleared) and fail
// CI; unused-vars stays a warning. Mark intentional fire-and-forget with `void`.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "webview-ui/**",
      ".vscode-test/**",
      "**/*.mjs",
      "**/*.js",
    ],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    // node:test's describe()/test() return promises the runner tracks itself.
    files: ["src/**/*.test.ts"],
    rules: { "@typescript-eslint/no-floating-promises": "off" },
  },
);
