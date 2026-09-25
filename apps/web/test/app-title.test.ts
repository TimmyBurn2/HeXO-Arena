import { describe, expect, it } from 'vitest';
import { appTitle } from '../src/app-title';

describe('appTitle', () => {
    it('is the site name', () => {
        expect(appTitle).toBe(`hexarena`);
    });
});
