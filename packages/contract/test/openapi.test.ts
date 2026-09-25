import { describe, expect, it } from 'vitest';
import {
    botTokenPath,
    botsPath,
    discordCallbackPath,
    discordLoginPath,
} from '../src';
import { buildOpenApiDocument } from '../src/openapi';

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
});
