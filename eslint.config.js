import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";

export default defineConfig([
  // 1. Global ignores (applies to the whole project)
  {
    ignores: ["dist/**", "node_modules/**", "build/**"]
  },

  // 2. Main configuration for JavaScript files
  {
    files: ["**/*.js", "**/*.mjs"],
    
    // Apply recommended rules out of the box
    plugins: { js },
    rules: {
      ...js.configs.recommended.rules,
      
      // Custom rule overrides
      "no-unused-vars": "warn",
      "no-console": "off",
      "semi": ["error", "always"],
      "quotes": ["error", "double"]
    },

    // Define environment variables and globals
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  }
]);
