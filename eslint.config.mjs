// ESLint flat config — intentionally a small, high-signal rule set.
//
// Only rules that catch real bugs are enabled (unawaited/misused promises,
// unused variables). Everything is a warning for now so the existing backlog
// does not block CI; `npm run lint` fails only on errors (e.g. parse errors).
// Promote rules to "error" once the backlog for that rule is cleared.
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
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
);
