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
    // Exactly `1` registers the dev login route; any other value leaves
    // it unregistered.
    DEV_LOGIN: z.string().default(``).transform((value) => value === `1`),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: unknown): Env {
    return envSchema.parse(source);
}
