import { legalDetailsExampleFile, legalDetailsFile } from '@hexo-arena/contract';
import { buildApp } from './app';
import { scheduleBackups } from './backup';
import { listenAdminSocket } from './admin-socket';
import { openDatabase, runMigrations } from './db';
import { parseEnv } from './env';
import { createDiscordOAuth } from './discord';
import { drainGraceMs } from './drain';
import { reportLegalDocuments } from './legal';
import { PresenceRegistry } from './presence';
import { handleStopSignals } from './signals';
import { GameWatchers } from './watchers';

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
    watchers: new GameWatchers(),
    adminActor: env.ADMIN_ACTOR,
    publicOrigin: env.PUBLIC_ORIGIN,
    trustedProxy: env.TRUSTED_PROXY,
    ...(env.WEB_INDEX_PATH !== `` && { webIndexPath: env.WEB_INDEX_PATH }),
    ...(env.BACKUP_DIR !== `` && { backup: { dir: env.BACKUP_DIR, keep: env.BACKUP_KEEP } }),
});

reportLegalDocuments(env.LEGAL_DIR, app.log, env.DEV_LOGIN ? legalDetailsExampleFile : legalDetailsFile);

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

// The close runs once whichever signal arrives, and the next boot's sweep
// aborts whatever an immediate stop left open.
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

handleStopSignals(process, env.DEV_FAST_STOP, {
    drain: () => {
        app.log.info(`draining: new starts refused, live games have ${String(drainGraceMs / 1000)} s`);
        void drainApp(drainGraceMs).then((aborted) => {
            app.log.info({ aborted }, `drained`);
            return close();
        });
    },
    stop: () => {
        void close();
    },
});

await app.listen({ port: env.PORT, host: env.HOST });
