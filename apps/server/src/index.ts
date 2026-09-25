import { buildApp } from './app';
import { openDatabase } from './db';
import { parseEnv } from './env';

const env = parseEnv(process.env);
const db = openDatabase(env.DATABASE_PATH);
const app = buildApp();

// once, not on: a second signal during shutdown must not start a
// concurrent close.
for (const signal of [`SIGINT`, `SIGTERM`] as const) {
    process.once(signal, () => {
        void app.close().then(() => {
            db.close();
            process.exit(0);
        });
    });
}

await app.listen({ port: env.PORT, host: env.HOST });
