import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  {
    ignores: [".next/**", "node_modules/**"],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default config;
