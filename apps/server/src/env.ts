import { isIP } from 'node:net';
import { z } from 'zod';

const envShape = z.object({
    HOST: z.string().default(`127.0.0.1`),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_PATH: z.string().min(1).default(`data/hexo-arena.sqlite`),
    // Public origin of the site: builds the OAuth redirect uri and the link
    // preview's image address, and decides whether the session cookie
    // carries Secure (TLS ends at the proxy).
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
    // Exactly `1` makes SIGTERM stop at once like SIGINT: tsx watch
    // restarts with SIGTERM and kills 5 s later, so a drain only delays them.
    DEV_FAST_STOP: z.string().default(``),
    // The container mounts a private tmpfs at /run/hexo-arena; the default
    // keeps a bare `pnpm dev` beside the database.
    ADMIN_SOCKET_PATH: z.string().min(1).default(`data/run/admin.sock`),
    ADMIN_ACTOR: z.string().min(1).max(64).default(`operator`),
    // Empty leaves the og shell routes off; Vite serves the page in dev.
    WEB_INDEX_PATH: z.string().default(``),
    // The operator's legal details, a JSON file no commit carries; empty
    // leaves the legal pages without them, which only development allows.
    LEGAL_DETAILS_PATH: z.string().default(``),
    // Empty leaves nightly backups off, which suits a bare `pnpm dev`.
    BACKUP_DIR: z.string().default(``),
    BACKUP_KEEP: z.coerce.number().int().min(1).max(365).default(14),
    BACKUP_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(3),
    // Caddy's fixed address on the internal network:
    // from this peer alone the last X-Forwarded-For address is the visitor's,
    // which the rate limits key by;
    // empty trusts no forwarded address.
    TRUSTED_PROXY: z
        .string()
        .default(``)
        .refine((value) => value === `` || isIP(value) !== 0, { message: `TRUSTED_PROXY must be an IP address` }),
});

/** Every variable the server reads; `.env.example` lists exactly these. */
export const envKeys = envShape.keyof().options;

const envSchema = envShape
    // A dev login in production would mint sessions for any name, so any
    // value at all, even one that leaves the route off, refuses the boot:
    // the env file is wrong and the operator must look at it.
    .refine((env) => env.NODE_ENV !== `production` || env.DEV_LOGIN === ``, {
        message: `DEV_LOGIN must be unset when NODE_ENV is production`,
        path: [`DEV_LOGIN`],
    })
    // Production must drain on SIGTERM, so the switch refuses the boot the same way.
    .refine((env) => env.NODE_ENV !== `production` || env.DEV_FAST_STOP === ``, {
        message: `DEV_FAST_STOP must be unset when NODE_ENV is production`,
        path: [`DEV_FAST_STOP`],
    })
    // The imprint must name the operator, so production never serves the
    // site without the details.
    .refine((env) => env.NODE_ENV !== `production` || env.LEGAL_DETAILS_PATH !== ``, {
        message: `LEGAL_DETAILS_PATH must name the legal details file when NODE_ENV is production`,
        path: [`LEGAL_DETAILS_PATH`],
    })
    // Without the proxy's address every visitor is one keyless caller,
    // so production refuses to run with only the global limits by mistake.
    .refine((env) => env.NODE_ENV !== `production` || env.TRUSTED_PROXY !== ``, {
        message: `TRUSTED_PROXY must name the proxy's address when NODE_ENV is production`,
        path: [`TRUSTED_PROXY`],
    })
    .transform(({ DEV_LOGIN, DEV_FAST_STOP, TRUSTED_PROXY, ...env }) => ({
        ...env,
        DEV_LOGIN: DEV_LOGIN === `1`,
        DEV_FAST_STOP: DEV_FAST_STOP === `1`,
        TRUSTED_PROXY: TRUSTED_PROXY === `` ? null : TRUSTED_PROXY,
    }));

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: unknown): Env {
    return envSchema.parse(source);
}
