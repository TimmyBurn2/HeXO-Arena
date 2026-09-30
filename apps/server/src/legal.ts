import { legalDetailsPath, legalDetailsSchema, type LegalDetails } from '@hexo-arena/contract';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

/**
 * The operator's legal details from the file the deployment provides.
 * Outside production the committed example's placeholders pass, so a dev
 * server shows its pages; production refuses them as it refuses a file it
 * cannot read or parse, and the boot ends.
 * Messages name where a value is wrong, never the value.
 */
export function readLegalDetails(path: string, production: boolean): LegalDetails {
    let text: string;
    try {
        text = readFileSync(path, `utf8`);
    } catch (error) {
        throw new Error(`LEGAL_DETAILS_PATH: cannot read ${path}`, { cause: error });
    }
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        // The parser's own message quotes the text around the fault, which
        // holds the operator's details, so it is left out.
        throw new Error(`LEGAL_DETAILS_PATH: ${path} is not JSON`);
    }
    const parsed = legalDetailsSchema.safeParse(json);
    if (!parsed.success) {
        const where = parsed.error.issues.map((issue) => {
            const at = z.core.toDotPath(issue.path) || `the top level`;
            return issue.code === `unrecognized_keys` ? `${at} (unknown ${issue.keys.join(`, `)})` : at;
        });
        throw new Error(`LEGAL_DETAILS_PATH: ${path} does not match the legal details at ${where.join(`, `)}`);
    }
    const placeholders = placeholderPaths(parsed.data);
    if (production && placeholders.length > 0) {
        throw new Error(`LEGAL_DETAILS_PATH: ${path} still holds placeholders at ${placeholders.join(`, `)}`);
    }
    return parsed.data;
}

/**
 * Where a value still holds the example's angle brackets, which no name,
 * address, or link needs, so a value holding one was never filled in.
 */
export function placeholderPaths(value: unknown, at = ``): string[] {
    if (typeof value === `string`) return /[<>]/.test(value) ? [at] : [];
    if (Array.isArray(value)) return value.flatMap((item: unknown, index) => placeholderPaths(item, `${at}[${String(index)}]`));
    if (typeof value === `object` && value !== null) {
        return Object.entries(value).flatMap(([key, item]: [string, unknown]) => placeholderPaths(item, at === `` ? key : `${at}.${key}`));
    }
    return [];
}

/** The public read of the details; a server started without them answers not found. */
export function registerLegalApi(app: FastifyInstance, details: LegalDetails | null): void {
    app.get(legalDetailsPath, { config: { limit: `public` } }, async (_request, reply) => {
        if (details === null) return reply.code(404).send({ error: `no legal details on this server`, code: `not_found` });
        return details;
    });
}
