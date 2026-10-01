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
    botConcurrentGameCap,
    defaultOpeningPlies,
    devAccountsPath,
    discordCallbackPath,
    discordLoginPath,
    gameEventsPath,
    gameMovePath,
    gamePath,
    gameResignPath,
    gamesPath,
    engineStrayFrameCap,
    gameTurnCap,
    healthzPath,
    leaderboardPath,
    legalDetailsPath,
    mePath,
    serverLineLimitBytes,
    signupPath,
    streamBacklogLimitBytes,
} from '../src';
import { buildOpenApiDocument } from '../src/openapi';

// The generated response types degrade to any (index-signature hack in
// openapi3-ts), so probes dig structurally instead of trusting the types.
// Probes read through local $refs: where a shape is defined is the
// document's layout, not its contract.
const root = buildOpenApiDocument();

function follow(value: unknown): unknown {
    if (typeof value !== `object` || value === null) return value;
    const ref: unknown = Reflect.get(value, `$ref`);
    if (typeof ref !== `string`) return value;
    return dig(root, ...ref.replace(`#/`, ``).split(`/`));
}

function dig(value: unknown, ...keys: string[]): unknown {
    let current: unknown = follow(value);
    for (const key of keys) {
        if (typeof current !== `object` || current === null) return undefined;
        current = follow(Reflect.get(current, key) as unknown);
    }
    return current;
}

function oneOf(schema: unknown): unknown[] {
    if (typeof schema !== `object` || schema === null || !(`oneOf` in schema)) return [];
    const variants = Reflect.get(schema, `oneOf`);
    // Narrowed by the Array.isArray check on the next line.
    return Array.isArray(variants) ? (variants as unknown[]) : [];
}

function visitObjects(value: unknown, visit: (node: object) => void): void {
    if (typeof value !== `object` || value === null) return;
    visit(value);
    Object.entries(value).forEach(([, child]: [string, unknown]) => {
        visitObjects(child, visit);
    });
}

function operationsIn(document: unknown): [string, unknown][] {
    const paths = dig(document, `paths`);
    if (typeof paths !== `object` || paths === null) return [];
    return Object.entries(paths).flatMap(([path, item]: [string, unknown]) =>
        typeof item === `object` && item !== null
            ? Object.entries(item).map(([method, operation]: [string, unknown]): [string, unknown] => [
                  `${method} ${path}`,
                  operation,
              ])
            : [],
    );
}

function repeatsIn(values: readonly string[]): string[] {
    return values.filter((value, index) => values.indexOf(value) !== index);
}

const operationDescriptionWordLimit = 60;

function arrayOfUnknown(value: unknown): unknown[] {
    // Array.isArray narrows unknown to any[]; this rebuilds the unknown[] view.
    return Array.isArray(value) ? (value as unknown[]) : [];
}

describe('openapi document', () => {
    it('lets every operation that takes a body answer 413 payload_too_large', () => {
        const operations = operationsIn(root).filter(([, operation]) => dig(operation, `requestBody`) !== undefined);
        expect(operations.length).toBeGreaterThan(5);
        for (const [name, operation] of operations) {
            const codes = arrayOfUnknown(dig(operation, `responses`, `413`, `content`, `application/json`, `schema`, `properties`, `code`, `enum`));
            expect(codes, name).toEqual([`payload_too_large`]);
        }
    });

    it('lets every operation answer 429 rate_limited with its Retry-After', () => {
        const operations = operationsIn(root);
        expect(operations.length).toBeGreaterThan(20);
        for (const [name, operation] of operations) {
            const limited = dig(operation, `responses`, `429`);
            expect(limited, name).toBeDefined();
            expect(dig(limited, `headers`, `Retry-After`), name).toBeDefined();
            const codes = arrayOfUnknown(dig(limited, `content`, `application/json`, `schema`, `properties`, `code`, `enum`));
            expect(codes, name).toContain(`rate_limited`);
        }
    });

    it('resolves every $ref to a component the document defines', () => {
        const document = buildOpenApiDocument();
        const refs: string[] = [];
        visitObjects(document, (node) => {
            const ref: unknown = Reflect.get(node, `$ref`);
            if (typeof ref === `string`) refs.push(ref);
        });
        expect(refs.length).toBeGreaterThan(0);
        for (const ref of refs) {
            expect(dig(document, ...ref.replace(`#/`, ``).split(`/`)), ref).toBeDefined();
        }
    });

    it('repeats no description text', () => {
        const descriptions: string[] = [];
        visitObjects(buildOpenApiDocument(), (node) => {
            const description: unknown = Reflect.get(node, `description`);
            if (typeof description === `string`) descriptions.push(description);
        });
        expect(descriptions.length).toBeGreaterThan(0);
        expect(repeatsIn(descriptions)).toEqual([]);
    });

    it(`keeps every operation description to ${String(operationDescriptionWordLimit)} words or fewer`, () => {
        const operations = operationsIn(buildOpenApiDocument());
        expect(operations.length).toBeGreaterThan(0);
        for (const [name, operation] of operations) {
            const description = dig(operation, `description`);
            const words = typeof description === `string` ? description.split(/\s+/).filter((word) => word !== ``) : [];
            expect(words.length, name).toBeLessThanOrEqual(operationDescriptionWordLimit);
        }
    });

    it('inlines no schema with properties in more than one place outside components', () => {
        const inlined: string[] = [];
        visitObjects(dig(buildOpenApiDocument(), `paths`), (node) => {
            if (`properties` in node) inlined.push(JSON.stringify(node));
        });
        expect(inlined.length).toBeGreaterThan(0);
        expect(repeatsIn(inlined)).toEqual([]);
    });

    it('names the opening length as an integer enum component without a default', () => {
        const component = dig(buildOpenApiDocument(), `components`, `schemas`, `OpeningPlies`);
        expect(dig(component, `type`)).toBe(`integer`);
        expect(dig(component, `enum`)).toEqual([1, 3, 5, 7, 9]);
        expect(dig(component, `default`)).toBeUndefined();
    });

    it('defaults the opening length to five plies on both creation requests', () => {
        const document = buildOpenApiDocument();
        for (const path of [botChallengePath, gamesPath]) {
            const field = dig(document, `paths`, path, `post`, `requestBody`, `content`, `application/json`, `schema`, `properties`, `openingPlies`);
            const parts = arrayOfUnknown(dig(field, `allOf`));
            const refs = parts.map((part): unknown => (typeof part === `object` && part !== null ? Reflect.get(part, `$ref`) : undefined));
            expect(refs).toContain(`#/components/schemas/OpeningPlies`);
            expect(parts.map((part) => dig(part, `default`))).toContain(defaultOpeningPlies);
        }
    });

    it('carries the site name as its title and on the session cookie', () => {
        const document = buildOpenApiDocument();
        expect(document.info.title).toBe(`HeXO Arena`);
        expect(dig(document, `components`, `securitySchemes`, `sessionCookie`, `name`)).toBe(`hexo_arena_session`);
    });

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

    it('documents the legal details read open to anyone, answering the named details', () => {
        const read = root.paths[legalDetailsPath]?.get;
        expect(read?.security).toEqual([]);
        const details = dig(root, `components`, `schemas`, `LegalDetails`);
        expect(dig(read, `responses`, `200`, `content`, `application/json`, `schema`)).toBe(details);
        expect(dig(details, `required`)).toEqual([`operator`, `host`, `supervisoryAuthority`]);
        expect(dig(read, `responses`, `404`)).toBeDefined();
    });

    it('documents the leaderboard route', () => {
        const document = buildOpenApiDocument();
        expect(document.paths[leaderboardPath]?.get).toBeDefined();
    });

    it('documents the discord oauth routes, the login taking where to return', () => {
        const document = buildOpenApiDocument();
        expect(document.paths[discordLoginPath]?.get).toBeDefined();
        expect(document.paths[discordCallbackPath]?.get).toBeDefined();
        const parameters = dig(document, `paths`, discordLoginPath, `get`, `parameters`);
        expect(Array.isArray(parameters) ? parameters.map((parameter: unknown) => dig(parameter, `name`)) : []).toEqual([`next`]);
    });

    it('documents the first sign-in behind its own cookie: read, create, and cancel', () => {
        const document = buildOpenApiDocument();
        for (const method of [`get`, `post`, `delete`]) {
            expect(dig(document, `paths`, signupPath, method, `security`)).toContainEqual({ signupCookie: [] });
        }
        const created = dig(document, `paths`, signupPath, `post`, `responses`);
        expect(Object.keys(created ?? {}).sort()).toEqual([`201`, `400`, `409`, `410`, `413`, `429`]);
        expect(dig(document, `components`, `securitySchemes`, `signupCookie`, `name`)).toBe(`hexo_arena_signup`);
    });

    // The Discord account behind a session is the person's own: it may
    // appear only in the reads that answer the person themselves.
    it('carries the Discord names only in the session read and the sign-up read', () => {
        const document = buildOpenApiDocument();
        const holders: string[] = [];
        const schemas = dig(document, `components`, `schemas`);
        for (const [name, schema] of Object.entries(schemas ?? {})) {
            visitObjects(schema, (node) => {
                if (Reflect.get(node, `$ref`) === `#/components/schemas/DiscordNames`) holders.push(name);
            });
        }
        expect([...new Set(holders)].sort()).toEqual([`Signup`, `User`]);
        const readers: string[] = [];
        for (const [path, item] of Object.entries(document.paths)) {
            visitObjects(item, (node) => {
                const ref: unknown = Reflect.get(node, `$ref`);
                if (ref === `#/components/schemas/User` || ref === `#/components/schemas/Signup`) readers.push(path);
            });
        }
        expect([...new Set(readers)].sort()).toEqual([mePath, signupPath]);
    });

    it('keeps the dev routes out of the public contract', () => {
        const document = buildOpenApiDocument();
        expect(Object.keys(document.paths).filter((path) => path.startsWith(`/api/dev/`))).toEqual([]);
        expect(JSON.stringify(document)).not.toContain(devAccountsPath);
    });

    it('documents the bot stream and account routes behind bearer auth', () => {
        const document = buildOpenApiDocument();
        const stream = dig(document, `paths`, botStreamPath, `get`);
        expect(dig(stream, `security`)).toEqual([{ bearerAuth: [] }]);
        expect(dig(stream, `responses`, `200`, `content`, `application/x-ndjson`)).toBeDefined();
        for (const method of [`get`, `patch`]) {
            const account = dig(document, `paths`, botAccountPath, method);
            expect(dig(account, `security`)).toEqual([{ bearerAuth: [] }]);
            expect(dig(account, `responses`, `200`, `content`, `application/json`)).toBeDefined();
        }
    });

    it('exposes the bearer scheme and the closed event union on the stream', () => {
        const document = buildOpenApiDocument();
        expect(dig(document, `components`, `securitySchemes`, `bearerAuth`)).toBeDefined();
        const schema = dig(document, `paths`, botStreamPath, `get`, `responses`, `200`, `content`, `application/x-ndjson`, `schema`);
        expect(oneOf(schema)).toHaveLength(6);
    });

    it('documents the human game actions behind the session cookie and the game read open to anyone', () => {
        const document = buildOpenApiDocument();
        expect(dig(document, `paths`, gamesPath, `post`, `security`)).toEqual([{ sessionCookie: [] }]);
        expect(dig(document, `paths`, gamesPath, `post`, `responses`, `201`)).toBeDefined();
        expect(dig(document, `paths`, gamePath, `get`, `security`)).toEqual([{ sessionCookie: [] }, {}]);
        expect(dig(document, `paths`, gamePath, `get`, `responses`, `401`)).toBeUndefined();
        expect(dig(document, `paths`, gameMovePath, `post`, `security`)).toEqual([{ sessionCookie: [] }]);
        expect(dig(document, `paths`, gameResignPath, `post`, `security`)).toEqual([{ sessionCookie: [] }]);
    });

    it('answers a quota with 429 and its wait: the creation cooldown and the challenge caps a day, and a spent sign-up with 410', () => {
        const document = buildOpenApiDocument();
        const cooldown = dig(document, `paths`, gamesPath, `post`, `responses`, `429`);
        expect(dig(cooldown, `headers`, `Retry-After`)).toBeDefined();
        expect(arrayOfUnknown(dig(cooldown, `content`, `application/json`, `schema`, `properties`, `code`, `enum`))).toEqual([`game_cooldown`, `rate_limited`]);
        expect(arrayOfUnknown(dig(document, `paths`, gamesPath, `post`, `responses`, `400`, `content`, `application/json`, `schema`, `properties`, `code`, `enum`))).not.toContain(`game_cooldown`);
        const daily = dig(document, `paths`, botChallengePath, `post`, `responses`, `429`);
        expect(dig(daily, `headers`, `Retry-After`)).toBeDefined();
        expect(arrayOfUnknown(dig(daily, `content`, `application/json`, `schema`, `properties`, `code`, `enum`))).toEqual([
            `daily_challenge_cap`,
            `daily_pair_cap`,
            `daily_bot_cap`,
            `rate_limited`,
        ]);
        expect(arrayOfUnknown(dig(document, `paths`, botChallengePath, `post`, `responses`, `400`, `content`, `application/json`, `schema`, `properties`, `code`, `enum`))).toContain(`challenge_pending`);
        expect(arrayOfUnknown(dig(document, `paths`, signupPath, `post`, `responses`, `410`, `content`, `application/json`, `schema`, `properties`, `code`, `enum`))).toEqual([`signup_expired`, `signup_limit`]);
    });

    it('states the line, backlog, and turn bounds where a reader meets them', () => {
        const document = buildOpenApiDocument();
        const description = (...path: string[]) => String(dig(document, ...path, `description`));
        const stream = description(`paths`, botStreamPath, `get`, `responses`, `200`);
        expect(stream).toContain(`${String(serverLineLimitBytes / 1024)} KiB`);
        expect(stream).toContain(`${String(streamBacklogLimitBytes / 1024)} KiB`);
        const engine = description(`paths`, botGameSocketPath, `get`, `responses`, `101`);
        expect(engine).toContain(`${String(serverLineLimitBytes / 1024)} KiB`);
        expect(engine).toContain(`${String(streamBacklogLimitBytes / 1024)} KiB`);
        expect(engine).toContain(`1008 after more than ${String(engineStrayFrameCap)} frames that answer no outstanding request, a malformed frame, or a protocol violation`);
        expect(description(`paths`, gameEventsPath, `get`, `responses`, `200`)).toContain(`${String(streamBacklogLimitBytes / 1024)} KiB`);
        expect(description(`components`, `schemas`, `FinishReason`)).toContain(`${String(gameTurnCap)} turns`);
    });

    it('counts the live games of each listed bot up to its cap', () => {
        const document = buildOpenApiDocument();
        const live = dig(document, `components`, `schemas`, `BotListing`, `properties`, `liveGames`);
        expect(live).toMatchObject({ type: `integer`, minimum: 0, maximum: botConcurrentGameCap });
        expect(dig(document, `components`, `schemas`, `BotListing`, `required`)).toContain(`liveGames`);
    });

    it('documents the live game list open to anyone as named entries', () => {
        const document = buildOpenApiDocument();
        const operation = dig(document, `paths`, gamesPath, `get`);
        expect(dig(operation, `security`)).toEqual([]);
        expect(dig(operation, `responses`, `200`, `content`, `application/json`, `schema`, `items`)).toEqual(
            dig(document, `components`, `schemas`, `LiveGameEntry`),
        );
    });

    it('documents the game event stream open to anyone, with named payloads and the watcher 429', () => {
        const document = buildOpenApiDocument();
        const operation = dig(document, `paths`, gameEventsPath, `get`);
        expect(dig(operation, `security`)).toEqual([{ sessionCookie: [] }, {}]);
        const schema = dig(operation, `responses`, `200`, `content`, `text/event-stream`, `schema`);
        const payloads = oneOf(schema).map((variant) => dig(variant, `properties`, `data`));
        expect(payloads).toEqual([
            dig(document, `components`, `schemas`, `GameSnapshot`),
            dig(document, `components`, `schemas`, `GameTurn`),
            dig(document, `components`, `schemas`, `GameFinish`),
        ]);
        expect(dig(operation, `responses`, `429`, `headers`, `Retry-After`)).toBeDefined();
        expect(dig(operation, `responses`, `404`)).toBeDefined();
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

    it('documents the pause refusal with Retry-After wherever something new starts', () => {
        const document = buildOpenApiDocument();
        const starts: [string, string][] = [
            [botStreamPath, `get`],
            [gamesPath, `post`],
            [botChallengePath, `post`],
            [challengeAcceptPath, `post`],
        ];
        for (const [path, method] of starts) {
            const refusal = dig(document, `paths`, path, method, `responses`, `503`);
            expect(dig(refusal, `headers`, `Retry-After`, `schema`)).toEqual({ type: `integer`, minimum: 1 });
            expect(dig(refusal, `content`, `application/json`)).toBeDefined();
        }
        expect(dig(document, `paths`, healthzPath, `get`, `responses`, `503`)).toBeDefined();
    });
});
