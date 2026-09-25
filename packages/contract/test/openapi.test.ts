import { describe, expect, it } from 'vitest';
import {
    botAccountPath,
    botChallengePath,
    botGameResignPath,
    botGameSocketPath,
    botStreamPath,
    botTokenPath,
    botsPath,
    challengeAcceptPath,
    challengeCancelPath,
    challengeDeclinePath,
    discordCallbackPath,
    discordLoginPath,
    gameMovePath,
    gamePath,
    gameResignPath,
    gamesPath,
} from '../src';
import { buildOpenApiDocument } from '../src/openapi';

// The generated response types degrade to any (index-signature hack in
// openapi3-ts), so probes dig structurally instead of trusting the types.
function dig(value: unknown, ...keys: string[]): unknown {
    let current: unknown = value;
    for (const key of keys) {
        if (typeof current !== `object` || current === null) return undefined;
        current = Reflect.get(current, key) as unknown;
    }
    return current;
}

function oneOf(schema: unknown): unknown[] {
    if (typeof schema !== `object` || schema === null || !(`oneOf` in schema)) return [];
    const variants = Reflect.get(schema, `oneOf`);
    // Narrowed by the Array.isArray check on the next line.
    return Array.isArray(variants) ? (variants as unknown[]) : [];
}

function arrayOfUnknown(value: unknown): unknown[] {
    // Array.isArray narrows unknown to any[]; this rebuilds the unknown[] view.
    return Array.isArray(value) ? (value as unknown[]) : [];
}

describe('openapi document', () => {
    it('documents the healthz route', () => {
        const document = buildOpenApiDocument();
        expect('/healthz' in document.paths).toBe(true);
    });

    it('documents the directory and bot management routes', () => {
        const document = buildOpenApiDocument();
        expect(document.paths[botsPath]?.get).toBeDefined();
        expect(document.paths[botsPath]?.post).toBeDefined();
        expect(document.paths[botTokenPath]?.post).toBeDefined();
    });

    it('documents the discord oauth routes', () => {
        const document = buildOpenApiDocument();
        expect(document.paths[discordLoginPath]?.get).toBeDefined();
        expect(document.paths[discordCallbackPath]?.get).toBeDefined();
    });

    it('keeps the dev login route out of the public contract', () => {
        const document = buildOpenApiDocument();
        expect(`/api/dev/login` in document.paths).toBe(false);
    });

    it('documents the bot stream and account routes behind bearer auth', () => {
        const document = buildOpenApiDocument();
        const stream = dig(document, `paths`, botStreamPath, `get`);
        expect(dig(stream, `security`)).toEqual([{ bearerAuth: [] }]);
        expect(dig(stream, `responses`, `200`, `content`, `application/x-ndjson`)).toBeDefined();
        const account = dig(document, `paths`, botAccountPath, `patch`);
        expect(dig(account, `security`)).toEqual([{ bearerAuth: [] }]);
        expect(dig(account, `responses`, `200`, `content`, `application/json`)).toBeDefined();
    });

    it('exposes the bearer scheme and the closed event union on the stream', () => {
        const document = buildOpenApiDocument();
        expect(dig(document, `components`, `securitySchemes`, `bearerAuth`)).toBeDefined();
        const schema = dig(document, `paths`, botStreamPath, `get`, `responses`, `200`, `content`, `application/x-ndjson`, `schema`);
        expect(oneOf(schema)).toHaveLength(6);
    });

    it('documents the human game surface behind the session cookie', () => {
        const document = buildOpenApiDocument();
        expect(dig(document, `paths`, gamesPath, `post`, `security`)).toEqual([{ sessionCookie: [] }]);
        expect(dig(document, `paths`, gamesPath, `post`, `responses`, `201`)).toBeDefined();
        expect(dig(document, `paths`, gamePath, `get`, `security`)).toEqual([{ sessionCookie: [] }]);
        expect(dig(document, `paths`, gameMovePath, `post`, `security`)).toEqual([{ sessionCookie: [] }]);
        expect(dig(document, `paths`, gameResignPath, `post`, `security`)).toEqual([{ sessionCookie: [] }]);
    });

    it('documents the engine-session socket with its token parameter and the bot resign', () => {
        const document = buildOpenApiDocument();
        const socket = dig(document, `paths`, botGameSocketPath, `get`);
        expect(dig(socket, `responses`, `101`)).toBeDefined();
        const params = arrayOfUnknown(dig(socket, `parameters`));
        const token = params.find((p: unknown) => dig(p, `name`) === `token`);
        expect(dig(token, `required`)).toBe(true);
        expect(dig(token, `in`)).toBe(`query`);
        expect(dig(document, `paths`, botGameResignPath, `post`, `security`)).toEqual([{ gameToken: [] }]);
        expect(dig(document, `components`, `securitySchemes`, `gameToken`)).toBeDefined();
    });

    it('documents the online filter on the directory', () => {
        const document = buildOpenApiDocument();
        const params = arrayOfUnknown(dig(document, `paths`, botsPath, `get`, `parameters`));
        const online = params.find((p: unknown) => dig(p, `name`) === `online`);
        expect(dig(online, `schema`)).toEqual({ type: `string`, enum: [`1`] });
    });

    it('documents the challenge surface behind bearer auth', () => {
        const document = buildOpenApiDocument();
        const create = dig(document, `paths`, botChallengePath, `post`);
        expect(dig(create, `security`)).toEqual([{ bearerAuth: [] }]);
        expect(dig(create, `responses`, `201`)).toBeDefined();
        expect(dig(create, `responses`, `200`)).toBeDefined();
        for (const path of [challengeAcceptPath, challengeDeclinePath, challengeCancelPath]) {
            const action = dig(document, `paths`, path, `post`);
            expect(dig(action, `security`)).toEqual([{ bearerAuth: [] }]);
            expect(dig(action, `responses`, `200`)).toBeDefined();
            expect(dig(action, `responses`, `404`)).toBeDefined();
        }
    });
});
