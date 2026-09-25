import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../src/openapi';

describe('openapi document', () => {
    it('documents the healthz route', () => {
        const document = buildOpenApiDocument();
        expect('/healthz' in document.paths).toBe(true);
    });
});
