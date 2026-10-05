import { defineConfig } from 'vite';

// The workspace packages export TypeScript source, so they bundle into the
// output; every registry dependency stays external and ships in the pruned
// node_modules, native better-sqlite3 included.
// Chunks sit beside the entries, since the migrations resolve relative to
// the module that runs them.
export default defineConfig({
    build: {
        ssr: true,
        target: `node26`,
        outDir: `dist`,
        emptyOutDir: true,
        rollupOptions: {
            input: { index: `src/index.ts`, 'admin-cli': `src/admin-cli.ts`, egress: `src/egress.ts` },
            output: { entryFileNames: `[name].js`, chunkFileNames: `[name]-[hash].js` },
        },
    },
    ssr: { noExternal: [`@hexo-arena/contract`, `@hexo-arena/rules`] },
});
