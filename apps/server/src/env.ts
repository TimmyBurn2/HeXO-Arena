import { z } from 'zod';

const envSchema = z.object({
    HOST: z.string().default(`127.0.0.1`),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_PATH: z.string().min(1).default(`data/hexarena.sqlite`),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: unknown): Env {
    return envSchema.parse(source);
}
