/* eslint-env node */
// ESLint v9 flat-config bridging to legacy shareable configs
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';

// Resolve shareable configs from project root (eslint:recommended, plugin:@typescript-eslint/recommended)
const compat = new FlatCompat({ baseDirectory: process.cwd(), recommendedConfig: js.configs.recommended });

export default [
  // Base recommended from @eslint/js
  js.configs.recommended,
  // Extend legacy shareable plugin config (@typescript-eslint)
  ...compat.extends('plugin:@typescript-eslint/recommended'),
  // Ignore build artifacts and deps
  {
    ignores: ['dist/**', 'node_modules/**', 'cache/**', 'assets/**', 'client/dist/**', '.eslintrc.cjs', 'eslint.config.js', 'LogsErreursTest.md'],
  },
  // Loosen some rules in TS sources to avoid blocking builds
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      'no-empty': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
];
