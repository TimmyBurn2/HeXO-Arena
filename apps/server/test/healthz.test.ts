import { healthzPath } from '@hexarena/contract';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

describe('GET /healthz', () => {
    it('answers 200 with no body', async () => {
        const app = buildApp();
        const response = await app.inject({ method: 'GET', url: healthzPath });
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe(``);
        await app.close();
    });
});
