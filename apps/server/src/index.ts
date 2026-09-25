import { buildApp } from './app';
import { scheduleBackups } from './backup';
import { listenAdminSocket } from './admin-socket';
import { openDatabase, runMigrations } from './db';
import { parseEnv } from './env';
import { createDiscordOAuth } from './discord';
import { drainGraceMs } from './drain';
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

const { app, admin, drain: drainApp } = await buildApp({
    sqlite: db,
    discord,
    secureCookies: env.PUBLIC_ORIGIN.startsWith(`https://`),
    devLogin: env.DEV_LOGIN,
    presence: new PresenceRegistry(),
    adminActor: env.ADMIN_ACTOR,
});

// An app running without its admin socket is the failure mode to avoid, so
// the socket binds before any public traffic and its absence ends boot.
const adminSocket = await listenAdminSocket(env.ADMIN_SOCKET_PATH, admin, app.log).catch((error: unknown) => {
    app.log.fatal({ err: error }, `admin socket unavailable at ${env.ADMIN_SOCKET_PATH}`);
    process.exit(1);
});

const backups =
    env.BACKUP_DIR === ``
        ? null
        : scheduleBackups(db, { dir: env.BACKUP_DIR, keep: env.BACKUP_KEEP, hourUtc: env.BACKUP_HOUR_UTC }, app.log);

// SIGTERM is the deploy path and drains; SIGINT is a developer's Ctrl-C
// and stops at once, cutting a drain short.
// Either way the close runs once, and the next boot's sweep aborts
// whatever an immediate stop left open.
let closing: Promise<void> | null = null;
function close(): Promise<void> {
    closing ??= (async () => {
        adminSocket.close();
        backups?.stop();
        await app.close();
        db.close();
        process.exit(0);
    })();
    return closing;
}

process.once(`SIGTERM`, () => {
    app.log.info(`draining: new starts refused, live games have ${String(drainGraceMs / 1000)} s`);
    void drainApp(drainGraceMs).then((aborted) => {
        app.log.info({ aborted }, `drained`);
        return close();
    });
});
process.once(`SIGINT`, () => {
    void close();
});

await app.listen({ port: env.PORT, host: env.HOST });
