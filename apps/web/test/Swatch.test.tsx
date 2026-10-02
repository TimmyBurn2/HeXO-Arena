// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Swatch } from '../src/components/player';

afterEach(() => {
    cleanup();
});

describe('Swatch', () => {
    it('draw a side as its stone on a board cell, hidden from assistive tech', () => {
        const { container } = render(<Swatch side="o" />);
        const swatch = container.querySelector(`svg.swatch`);
        expect(swatch?.getAttribute(`aria-hidden`)).toBe(`true`);
        expect(swatch?.querySelector(`polygon.swatch-cell`)).not.toBe(null);
        expect(swatch?.querySelector(`polygon.swatch-stone.swatch-stone-o`)).not.toBe(null);
    });
});
