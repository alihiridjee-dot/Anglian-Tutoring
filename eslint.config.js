import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const SERVER_ONLY = {
  name: "server-only",
  message:
    "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
};

/**
 * The layering, lowest first: lib -> hooks -> components -> routes. A layer may
 * import the ones before it and never the ones after. A later block replaces
 * `no-restricted-imports` outright rather than merging, so each one carries
 * SERVER_ONLY with it.
 */
const layer = (files, above, why) => ({
  files,
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [SERVER_ONLY],
        patterns: [{ group: above.flatMap((dir) => [`@/${dir}`, `@/${dir}/**`]), message: why }],
      },
    ],
  },
});

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", ".claude"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": ["error", { paths: [SERVER_ONLY] }],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  layer(
    ["src/lib/**/*.{ts,tsx}"],
    ["hooks", "components", "routes"],
    "lib/ is framework-free domain code. Move the shared type or pure function into lib/ instead.",
  ),
  layer(
    ["src/hooks/**/*.{ts,tsx}"],
    ["components", "routes"],
    "hooks/ sits below the UI. A hook must not depend on a component or a route.",
  ),
  layer(
    ["src/components/**/*.{ts,tsx}"],
    ["routes"],
    "components/ must not import from routes/. Lift the shared piece into components/ or lib/.",
  ),
  eslintPluginPrettier,
);
