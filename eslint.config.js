import eslint from '@eslint/js';
import { execFileSync } from 'node:child_process';
import tsdocPlugin from 'eslint-plugin-tsdoc';
import tseslint from 'typescript-eslint';

// Lint covers the repository's own files: whatever git ignores, by the
// committed rules or a clone's local ones, is left out. Outside a git
// checkout only the fixed list applies.
function ignoredByGit() {
    try {
        return execFileSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], {
            cwd: import.meta.dirname,
            encoding: 'utf8',
        })
            .split('\n')
            .filter((path) => path !== '');
    } catch {
        return [];
    }
}

export default tseslint.config(
    { ignores: ['**/dist/', '**/coverage/', 'data/', 'node_modules/', 'openapi.yaml', ...ignoredByGit()] },
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
