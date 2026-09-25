import { z } from 'zod';

const envSchema = z.object({
    HOST: z.string().default(`127.0.0.1`),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_PATH: z.string().min(1).default(`data/hexarena.sqlite`),
    // Public origin of the site: builds the OAuth redirect uri and decides
    // whether the session cookie carries Secure (TLS ends at the proxy).
    PUBLIC_ORIGIN: z
        .string()
        .default(`http://localhost:3000`)
        .transform((origin) => origin.replace(/\/+$/, ``)),
    DISCORD_CLIENT_ID: z.string().default(``),
    DISCORD_CLIENT_SECRET: z.string().default(``),
    NODE_ENV: z.string().default(``),
    // Exactly `1` registers the dev login route; any other value leaves
    // it unregistered.
    DEV_LOGIN: z.string().default(``),
    // The container mounts a private tmpfs at /run/hexarena; the default
    // keeps a bare `pnpm dev` beside the database.
    ADMIN_SOCKET_PATH: z.string().min(1).default(`data/run/admin.sock`),
    ADMIN_ACTOR: z.string().min(1).max(64).default(`operator`),
    // Empty leaves nightly backups off, which suits a bare `pnpm dev`.
    BACKUP_DIR: z.string().default(``),
    BACKUP_KEEP: z.coerce.number().int().min(1).max(365).default(14),
    BACKUP_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(3),
})
    // A dev login in production would mint sessions for any name, so any
    // value at all, even one that leaves the route off, refuses the boot:
    // the env file is wrong and the operator must look at it.
    .refine((env) => env.NODE_ENV !== `production` || env.DEV_LOGIN === ``, {
        message: `DEV_LOGIN must be unset when NODE_ENV is production`,
        path: [`DEV_LOGIN`],
    })
    .transform(({ DEV_LOGIN, ...env }) => ({ ...env, DEV_LOGIN: DEV_LOGIN === `1` }));

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: unknown): Env {
    return envSchema.parse(source);
}
