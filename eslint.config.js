import eslint from '@eslint/js';
import tsdocPlugin from 'eslint-plugin-tsdoc';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist/', 'coverage/', 'data/', 'node_modules/', 'openapi.yaml'] },
    eslint.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: { tsdoc: tsdocPlugin },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            'tsdoc/syntax': 'error',
        },
    },
    {
        files: ['eslint.config.js', 'scripts/**/*.mjs'],
        ...tseslint.configs.disableTypeChecked,
    },
    {
        files: ['eslint.config.js', 'scripts/**/*.mjs'],
        // These files run under node, where console and process are
        // ambient; no-undef needs them named.
        languageOptions: { globals: { console: `readonly`, process: `readonly` } },
    },
);
