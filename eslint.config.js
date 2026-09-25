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
        files: ['eslint.config.js'],
        ...tseslint.configs.disableTypeChecked,
    },
);
