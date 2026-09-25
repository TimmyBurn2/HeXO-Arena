import { buildApp } from './app';
import { openDatabase, runMigrations } from './db';
import { parseEnv } from './env';
import { createDiscordOAuth } from './discord';
import { PresenceRegistry } from './presence';

const env = parseEnv(process.env);
const db = openDatabase(env.DATABASE_PATH);
runMigrations(db);

const discord =
    env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET
        ? createDiscordOAuth({
              clientId: env.DISCORD_CLIENT_ID,
              clientSecret: env.DISCORD_CLIENT_SECRET,
              redirectUri: `${env.PUBLIC_ORIGIN}/api/auth/discord/callback`,
          })
        : null;

const app = await buildApp({
    sqlite: db,
    discord,
    secureCookies: env.PUBLIC_ORIGIN.startsWith(`https://`),
    devLogin: env.DEV_LOGIN,
    presence: new PresenceRegistry(),
});

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
