// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportScreen } from '../src/screens/ReportScreen';

type Sent = { url: string; body: unknown };

// Every read answers empty; a report answers as the server would, or with the refusal given.
function serve(answer: { status: number; retryAfter?: string } = { status: 201 }): Sent[] {
    const sent: Sent[] = [];
    vi.stubGlobal(`scrollTo`, () => undefined);
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string, init?: RequestInit) => {
            if (init?.method === `POST`) {
                sent.push({ url, body: typeof init.body === `string` ? (JSON.parse(init.body) as unknown) : null });
                const body = answer.status === 201 ? { id: 12 } : { error: `too many requests`, code: `rate_limited` };
                return Promise.resolve(new Response(JSON.stringify(body), { status: answer.status, headers: answer.retryAfter === undefined ? {} : { 'retry-after': answer.retryAfter } }));
            }
            return Promise.resolve(new Response(`null`, { status: 404 }));
        }),
    );
    return sent;
}

function open(path: string): void {
    window.history.replaceState(null, ``, path);
    render(<ReportScreen />);
}

function fill(label: string, value: string): void {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, ``, `/`);
});

describe('ReportScreen', () => {
    it('take the page it was opened from as the subject, and send the report with what the reporter gave', async () => {
        const sent = serve();
        open(`/report?subject=${encodeURIComponent(`/bots/sealbot`)}`);
        expect(screen.getByLabelText<HTMLInputElement>(`Page`).value).toBe(`/bots/sealbot`);
        fill(`Reason`, `name`);
        fill(`What is wrong`, `The about text insults another player.`);
        fill(`Email`, `quinn@example.org`);
        fireEvent.click(screen.getByLabelText(`This report is accurate, and I send it in good faith`));
        fireEvent.click(screen.getByRole(`button`, { name: `Send report` }));
        expect(await screen.findByRole(`heading`, { name: `Report 12 received` })).toBeTruthy();
        expect(sent).toEqual([
            { url: `/api/reports`, body: { subject: `/bots/sealbot`, reason: `name`, details: `The about text insults another player.`, goodFaith: true, email: `quinn@example.org` } },
        ]);
        expect(screen.getByRole(`link`, { name: `Back to the page` }).getAttribute(`href`)).toBe(`/bots/sealbot`);
        fireEvent.click(screen.getByRole(`button`, { name: `Send another report` }));
        expect(screen.getByLabelText<HTMLInputElement>(`Page`).value).toBe(`/bots/sealbot`);
        expect(screen.getByLabelText<HTMLTextAreaElement>(`What is wrong`).value).toBe(``);
    });

    it('name every field the report lacks, and send nothing', () => {
        const sent = serve();
        open(`/report`);
        fireEvent.click(screen.getByRole(`button`, { name: `Send report` }));
        expect([...document.querySelectorAll(`.field-error`)].map((line) => line.textContent)).toEqual([
            `Give an address on this site, such as /bots/sealbot`,
            `Pick a reason`,
            `Say what is wrong`,
            `Confirm that the report is accurate and in good faith`,
        ]);
        expect(screen.getByLabelText(`Page`).getAttribute(`aria-describedby`)).toBe(`report-subject-note report-subject-error`);
        expect(sent).toEqual([]);
    });

    it('move focus to the first field the report lacks, which reads out its error', () => {
        serve();
        open(`/report?subject=${encodeURIComponent(`/bots/sealbot`)}`);
        fireEvent.click(screen.getByRole(`button`, { name: `Send report` }));
        expect(document.activeElement).toBe(screen.getByLabelText(`Reason`));
        fill(`Reason`, `name`);
        fill(`What is wrong`, `The about text insults another player.`);
        fireEvent.click(screen.getByRole(`button`, { name: `Send report` }));
        const goodFaith = screen.getByLabelText(`This report is accurate, and I send it in good faith`);
        expect(document.activeElement).toBe(goodFaith);
        expect(goodFaith.getAttribute(`aria-invalid`)).toBe(`true`);
        expect(document.getElementById(goodFaith.getAttribute(`aria-describedby`) ?? ``)?.textContent).toBe(`Confirm that the report is accurate and in good faith`);
    });

    it('read a pasted address of this site as its path, and refuse one of another site', async () => {
        const sent = serve();
        open(`/report`);
        fill(`Reason`, `cheating`);
        fill(`What is wrong`, `Two accounts.`);
        fireEvent.click(screen.getByLabelText(`This report is accurate, and I send it in good faith`));
        fill(`Page`, `https://elsewhere.example/game/g_1`);
        fireEvent.click(screen.getByRole(`button`, { name: `Send report` }));
        expect(screen.getByText(`Give an address on this site, such as /bots/sealbot`)).toBeTruthy();
        fill(`Page`, `${window.location.origin}/game/g_1?turn=3`);
        fireEvent.click(screen.getByRole(`button`, { name: `Send report` }));
        await screen.findByRole(`heading`, { name: `Report 12 received` });
        expect(sent.map((entry) => (entry.body as { subject: string }).subject)).toEqual([`/game/g_1?turn=3`]);
    });

    it('leave a subject the link names off the form when it is no page of this site', () => {
        serve();
        open(`/report?subject=${encodeURIComponent(`https://elsewhere.example/x`)}`);
        expect(screen.getByLabelText<HTMLInputElement>(`Page`).value).toBe(``);
    });

    it('hold the form for the wait a refused report names', async () => {
        serve({ status: 429, retryAfter: `420` });
        open(`/report?subject=%2Fplayers%2Fana`);
        fill(`Reason`, `abuse`);
        fill(`What is wrong`, `Threats in a bot's about text.`);
        fireEvent.click(screen.getByLabelText(`This report is accurate, and I send it in good faith`));
        fireEvent.click(screen.getByRole(`button`, { name: `Send report` }));
        await waitFor(() => {
            expect(screen.getByRole(`alert`).textContent).toContain(`Too many tries; try again in 7 minutes`);
        });
        expect(screen.getByRole<HTMLButtonElement>(`button`, { name: `Send report` }).disabled).toBe(true);
    });
});
