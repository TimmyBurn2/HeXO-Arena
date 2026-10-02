// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock } from '../src/components/CodeBlock';

const code = [`import os`, ``, `print(os.getcwd())`].join(`\n`);

// jsdom has no clipboard, as a page served without TLS has none; a test
// that wants one lends it to the navigator and takes it back after.
function lendClipboard(writeText: (value: string) => Promise<void>): void {
    Object.defineProperty(navigator, `clipboard`, { value: { writeText }, configurable: true });
}

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, `clipboard`);
    window.getSelection()?.removeAllRanges();
});

function renderSample(): void {
    render(<CodeBlock title={`bot.py`} name={`bot.py, a whole bot`} copyLabel={`Copy bot.py`} code={code} />);
}

describe('CodeBlock', () => {
    it('show the sample in monospace under its title, named for assistive technology', () => {
        renderSample();
        const figure = screen.getByRole(`figure`, { name: `bot.py, a whole bot` });
        expect(figure.querySelector(`pre code`)?.textContent).toBe(code);
        expect(figure.querySelector(`.code-title`)?.textContent).toBe(`bot.py`);
        expect(screen.getByRole(`button`, { name: `Copy bot.py` }).textContent).toBe(`Copy`);
    });

    it('put the sample on the clipboard from the click and say it is copied', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        lendClipboard(writeText);
        renderSample();
        fireEvent.click(screen.getByRole(`button`, { name: `Copy bot.py` }));
        expect(writeText).toHaveBeenCalledWith(code);
        expect(await screen.findByText(`Copied`)).toBeTruthy();
        expect(screen.getByRole(`status`).textContent).toBe(`Copied`);
        expect(window.getSelection()?.toString()).toBe(``);
    });

    it('select the sample for the reader to copy where the browser has no clipboard', async () => {
        renderSample();
        fireEvent.click(screen.getByRole(`button`, { name: `Copy bot.py` }));
        expect(await screen.findByText(`Selected; press Ctrl+C or Cmd+C`)).toBeTruthy();
        expect(window.getSelection()?.toString()).toBe(code);
    });

    it('select the sample when the browser refuses the clipboard', async () => {
        lendClipboard(() => Promise.reject(new DOMException(`denied`, `NotAllowedError`)));
        renderSample();
        fireEvent.click(screen.getByRole(`button`, { name: `Copy bot.py` }));
        expect(await screen.findByText(`Selected; press Ctrl+C or Cmd+C`)).toBeTruthy();
        expect(window.getSelection()?.toString()).toBe(code);
    });
});
