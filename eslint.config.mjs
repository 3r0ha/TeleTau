// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/*.generated.*",
      "**/generated/**",
      "ios/**",
      "android/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
  {
    // Линт с учётом типов для серверных приложений: необработанные промисы — частая причина тихих сбоев
    // в NestJS, Fastify и BullMQ. Только два правила, чтобы не раздувать объём.
    files: ["apps/api/**/*.ts", "apps/workers/**/*.ts", "apps/bot/**/*.ts"],
    ignores: ["**/*.config.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    // Клиенты веба и консоли и их общие пакеты: правила хуков React и необработанные промисы в обработчиках
    // (onClick={async …} без catch, забытый await) — без них сбой сети молча оставляет экран в «загрузке».
    files: [
      "apps/web/{app,i18n,test}/**/*.{ts,tsx}",
      "apps/web/{proxy,instrumentation}.ts",
      "apps/console/{app,test}/**/*.{ts,tsx}",
      "apps/console/{proxy,instrumentation}.ts",
      "packages/ui/{src,test}/**/*.{ts,tsx}",
      "packages/session/{src,test}/**/*.{ts,tsx}",
    ],
    plugins: { "react-hooks": reactHooks },
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    // Код браузера: crypto.randomUUID есть только в защищённом контексте (https, localhost), по http в локальной сети
    // его нет. Идентификаторы — через uuidv7() (getRandomValues).
    files: ["apps/web/app/**/*.{ts,tsx}", "apps/console/app/**/*.{ts,tsx}", "packages/ui/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "crypto", property: "randomUUID", message: "Только в защищённом контексте: используйте uuidv7() из _components/learn/ids." },
      ],
    },
  },
  {
    // Service worker веба: глобальные объекты воркера (self, caches, clients), а не Node.
    files: ["apps/web/public/sw.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.serviceworker } },
  },
);
