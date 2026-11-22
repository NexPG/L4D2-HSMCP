import tseslint from "typescript-eslint";

/**
 * The static gate TypeScript cannot provide: promises that are neither awaited nor
 * explicitly discarded, async callbacks handed to APIs that ignore the returned promise,
 * and `await` on something that is not thenable.
 *
 * Formatting is not linted. The code style is already consistent, and a formatter
 * retrofitted to a 200-file tree produces a diff that says nothing about behaviour.
 * TypeScript strict mode plus `noUnusedLocals`/`noUnusedParameters` covers the rest of what
 * this repository needs; `recommended` is kept for the correctness rules it does add.
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".hammer-mcp/**",
      "addons/**",
      "campaigns/**",
      ".3d-projects/**",
    ],
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.test.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // TypeScript already reports these, with types, and the sidecar replies are `any`
      // by design: the JSON contract is checked at the tool boundary, not here.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      // The three rules worth the type-aware parser.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
);
