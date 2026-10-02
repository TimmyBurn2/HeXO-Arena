// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { meStore } from '../src/me';
import { BotScreen } from '../src/screens/BotScreen';
import { botApiRepository } from '../src/site-links';

const sealbot = {
    name: `sealbot`,
    ownerName: `quinn`,
    online: true,
    openForChallenges: true,
    rating: 1712,
    provisional: false,
    liveGames: 0,
    about: `A clean-room HeXO engine with a rotation opener.`,
    version: `0.3.1`,
    repoUrl: `https://github.com/quinn/sealbot`,
    accepts: { turnMs: [5000, 60000], match: true, unlimited: true },
};

function stubDirectory(rows: unknown[], status = 200): void {
    vi.stubGlobal(
        `fetch`,
        vi.fn(() => Promise.resolve(new Response(JSON.stringify(rows), { status }))),
    );
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    meStore.reset();
});

// A history of twelve games, of which a page holds every one.
function history(player: string): unknown {
    const games = Array.from({ length: 12 }, (_, index) => ({
        gameId: `g-${String(index)}`,
        players: {
            x: { name: player, rating: 1700, provisional: false, kind: player === `quinn` ? `user` : `bot` },
            o: { name: `hextide`, rating: 1690, provisional: false, kind: `bot` },
        },
        winner: index % 2 === 0 ? `x` : `o`,
        reason: `six-in-a-row`,
        timeControl: { mode: `unlimited` },
        openingPlies: 1,
        turns: 20,
        finishedAt: new Date(Date.now() - (index + 1) * 3_600_000).toISOString(),
        rated: true,
        voided: false,
    }));
    return { games, page: 1, pages: 1, total: 12, record: { games: 12, won: 6, lost: 6, undecided: 0, voided: 0, asX: { games: 12, won: 6, lost: 6 }, asO: { games: 0, won: 0, lost: 0 } } };
}

// The owner panel needs a session, so these serve me beside the directory
// and record every write.
function serveAs(name: string, writes: { method: string; url: string }[], deleteStatus = 204): void {
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string, init?: RequestInit) => {
            const method = init?.method ?? `GET`;
            if (method !== `GET`) {
                writes.push({ method, url });
                if (method === `DELETE`) {
                    return Promise.resolve(
                        new Response(deleteStatus === 204 ? null : JSON.stringify({ error: `seated`, code: `in_game` }), {
                            status: deleteStatus,
                        }),
                    );
                }
                return Promise.resolve(new Response(JSON.stringify({ name: `sealbot`, token: `hxo_${`c`.repeat(43)}` })));
            }
            const body = url === `/api/me` ? { kind: `user`, name, rating: 1503, provisional: false, discord: null, liveGames: [] } : [sealbot];
            return Promise.resolve(new Response(JSON.stringify(body)));
        }),
    );
    meStore.reset();
    meStore.start();
}

describe('BotScreen', () => {
    it('list its five latest games, then lead to all of them in Games', async () => {
        const reads: string[] = [];
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) => {
                reads.push(url);
                const body = url.startsWith(`/api/games/finished`) ? history(`sealbot`) : url === `/api/games` ? [] : [sealbot];
                return Promise.resolve(new Response(JSON.stringify(body)));
            }),
        );
        render(<BotScreen name="sealbot" />);
        const section = (await screen.findByRole(`heading`, { name: `Recent games` })).closest(`section`) as HTMLElement;
        await waitFor(() => {
            expect(within(section).getAllByRole(`listitem`)).toHaveLength(5);
        });
        expect(within(section).getAllByRole(`listitem`).map((item) => within(item).getByRole(`link`).getAttribute(`href`))).toEqual([`/game/g-0`, `/game/g-1`, `/game/g-2`, `/game/g-3`, `/game/g-4`]);
        expect(within(section).getByRole(`link`, { name: `All 12 games` }).getAttribute(`href`)).toBe(`/games?player=sealbot`);
        expect(reads).toContain(`/api/games/finished?player=sealbot`);
    });

    it('count its games against guests apart in its record, and tag a guest\'s game in its list unrated', async () => {
        const record = {
            name: `sealbot`,
            kind: `bot`,
            rating: 1712,
            deviation: 60,
            provisional: false,
            rank: null,
            games: 4,
            won: 3,
            lost: 1,
            undecided: 0,
            asX: { games: 2, won: 2 },
            asO: { games: 2, won: 1 },
            forfeits: { disconnect: 0, terminated: 0 },
            opponents: [],
            firstGameAt: `2026-09-20T10:00:00Z`,
            lastGameAt: `2026-10-01T10:00:00Z`,
            placings: [],
            guests: { games: 3, won: 2, lost: 1 },
        };
        const guestGame = {
            gameId: `g-guest`,
            players: { x: { name: `sealbot`, rating: null, provisional: false, kind: `bot` }, o: { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` } },
            winner: `x`,
            reason: `six-in-a-row`,
            timeControl: { mode: `unlimited` },
            openingPlies: 1,
            turns: 12,
            finishedAt: new Date(Date.now() - 3_600_000).toISOString(),
            rated: false,
            voided: false,
        };
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) => {
                const body = url.startsWith(`/api/games/finished`)
                    ? { games: [guestGame], page: 1, pages: 1, total: 1, record: { games: 1, won: 1, lost: 0, undecided: 0, voided: 0, asX: { games: 1, won: 1, lost: 0 }, asO: { games: 0, won: 0, lost: 0 } } }
                    : url.startsWith(`/api/players/sealbot/rating`)
                      ? []
                      : url.startsWith(`/api/players/`)
                        ? record
                        : url === `/api/games`
                          ? []
                          : [sealbot];
                return Promise.resolve(new Response(JSON.stringify(body)));
            }),
        );
        render(<BotScreen name="sealbot" />);
        const card = await screen.findByRole(`region`, { name: `Record` });
        expect(within(card).getByText(`Against guests`).nextElementSibling?.textContent).toBe(`3 games, 2 won, 1 lost; unrated, and counted apart`);
        const row = await screen.findByRole(`link`, { name: /Guest k3f9/u });
        expect(row.querySelector(`.tag`)?.textContent).toBe(`unrated`);
        expect(within(row).queryByRole(`link`)).toBe(null);
    });

    it('head the page with the bot\'s name in its plate while the bot list loads, where the loaded page holds it', async () => {
        let answer: (response: Response) => void = () => undefined;
        vi.stubGlobal(`fetch`, vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; })));
        render(<BotScreen name="sealbot" />);
        const pending = screen.getByRole(`heading`, { level: 1, name: `sealbot` });
        expect(pending.closest(`.bot-plate .bot-title`)).toBeTruthy();
        expect(pending.closest(`.bot-plate`)?.querySelector(`.badge-bot`)).toBeTruthy();
        expect(document.querySelector(`.skeleton`)).toBeTruthy();
        answer(new Response(JSON.stringify([sealbot])));
        await screen.findByText(`A clean-room HeXO engine with a rotation opener.`);
        expect(screen.getByRole(`heading`, { level: 1, name: `sealbot` }).closest(`.bot-plate .bot-title`)).toBeTruthy();
    });

    it('say a bot that has finished no game has none yet', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) => {
                const body = url.startsWith(`/api/games/finished`) ? { games: [], page: 1, pages: 0, total: 0, record: { games: 0, won: 0, lost: 0, undecided: 0, voided: 0, asX: { games: 0, won: 0, lost: 0 }, asO: { games: 0, won: 0, lost: 0 } } } : url === `/api/games` ? [] : [sealbot];
                return Promise.resolve(new Response(JSON.stringify(body)));
            }),
        );
        render(<BotScreen name="sealbot" />);
        const section = (await screen.findByRole(`heading`, { name: `Recent games` })).closest(`section`) as HTMLElement;
        expect(await within(section).findByText(`No finished games yet.`)).toBeTruthy();
        expect(within(section).queryByRole(`link`)).toBe(null);
    });

    it('show the declaration, accepts table, and Play linking to the Play page', async () => {
        stubDirectory([sealbot]);
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByRole(`heading`, { name: `sealbot` })).toBeTruthy();
        expect(screen.getByText(`A clean-room HeXO engine with a rotation opener.`)).toBeTruthy();
        expect(screen.getByText(`5 to 60 s`)).toBeTruthy();
        const owner = screen.getByRole(`link`, { name: `quinn` });
        expect(owner.parentElement?.textContent).toBe(`By quinn`);
        expect(owner.getAttribute(`href`)).toBe(`/players/quinn`);
        expect(document.querySelector(`.bot-rating-number`)?.textContent).toBe(`1712`);
        // The repository reads whole and may break only after a slash.
        const repo = document.querySelector(`a[href="https://github.com/quinn/sealbot"]`);
        expect(repo?.textContent).toBe(`github.com/quinn/sealbot`);
        expect(repo?.querySelectorAll(`wbr`)).toHaveLength(2);
        expect(screen.getByRole(`link`, { name: `Play sealbot` }).getAttribute(`href`)).toBe(`/play?bot=sealbot`);
        await waitFor(() => {
            expect(document.title).toBe(`sealbot - HeXO Arena`);
        });
        expect(document.querySelector(`meta[name="description"]`)?.getAttribute(`content`)).toBe(
            `HeXO bot by quinn, rated 1712, online and open for challenges. A clean-room HeXO engine with a rotation opener`,
        );
    });

    it('lead to the report form about the bot from the foot of its page', async () => {
        stubDirectory([sealbot]);
        render(<BotScreen name="sealbot" />);
        const link = await screen.findByRole(`link`, { name: `Report sealbot` });
        expect(link.getAttribute(`href`)).toBe(`/report?subject=%2Fbots%2Fsealbot`);
    });

    it('match the name on the case-insensitive fold', async () => {
        stubDirectory([sealbot]);
        render(<BotScreen name="SealBot" />);
        expect(await screen.findByRole(`heading`, { name: `sealbot` })).toBeTruthy();
    });

    it('disable play with one clause when the bot is closed', async () => {
        stubDirectory([{ ...sealbot, openForChallenges: false }]);
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByRole(`button`, { name: `Play sealbot` })).toBeTruthy();
        expect(document.querySelector(`.btn-primary`)?.hasAttribute(`disabled`)).toBe(true);
        expect(screen.getByText(`Closed for challenges`)).toBeTruthy();
    });

    it('disable play with the reason when the bot is at its game cap', async () => {
        stubDirectory([{ ...sealbot, liveGames: 4 }]);
        render(<BotScreen name="sealbot" />);
        expect((await screen.findByRole(`button`, { name: `Play sealbot` })).hasAttribute(`disabled`)).toBe(true);
        expect(screen.queryByRole(`link`, { name: `Play sealbot` })).toBe(null);
        expect(screen.getByText(`In 4 games; try again shortly`, { selector: `.play-reason` })).toBeTruthy();
    });

    it('explain an absent declaration and disable play', async () => {
        const bare = { ...sealbot, about: undefined, version: undefined, repoUrl: undefined, accepts: undefined };
        stubDirectory([bare]);
        render(<BotScreen name="sealbot" />);
        // The card and the reason beside the disabled button say it the same way.
        await screen.findByText(`Nothing yet`, { selector: `.card .note` });
        expect(document.querySelector(`.btn-primary`)?.hasAttribute(`disabled`)).toBe(true);
        expect(screen.getByText(`Accepts nothing yet`, { selector: `.play-reason` })).toBeTruthy();
    });

    it('show the owner of a bot that accepts nothing where that is set', async () => {
        const bare = { ...sealbot, accepts: undefined };
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) =>
                Promise.resolve(new Response(JSON.stringify(url === `/api/me` ? { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] } : [bare]))),
            ),
        );
        meStore.reset();
        meStore.start();
        render(<BotScreen name="sealbot" />);
        const note = await screen.findByText(/^Nothing yet; your bot lists/u, { selector: `.card .note` });
        expect(note.textContent).toBe(`Nothing yet; your bot lists the clocks it accepts through the Bot API.`);
        expect(within(note).getByRole(`link`, { name: `Bot API` }).getAttribute(`href`)).toBe(botApiRepository);
    });

    it('mark provisional ratings', async () => {
        stubDirectory([{ ...sealbot, provisional: true }]);
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByText(`?`)).toBeTruthy();
    });

    it('say when no such bot exists', async () => {
        stubDirectory([sealbot]);
        render(<BotScreen name="driftwood" />);
        expect(await screen.findByText(`No bot named driftwood`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Browse bots` }).getAttribute(`href`)).toBe(`/bots`);
        await waitFor(() => {
            expect(document.title).toBe(`Not found - HeXO Arena`);
        });
    });

    it('go to the Play page with the bot named from Play', async () => {
        stubDirectory([sealbot]);
        window.history.replaceState(null, ``, `/bots/sealbot`);
        render(<BotScreen name="sealbot" />);
        fireEvent.click(await screen.findByRole(`link`, { name: `Play sealbot` }));
        expect(window.location.pathname + window.location.search).toBe(`/play?bot=sealbot`);
        window.history.replaceState(null, ``, `/`);
    });

    it('hold the retry of a rate-limited read for its wait', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `6` } }))),
        );
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByText(`The bot did not load`)).toBeTruthy();
        await waitFor(() => {
            expect(document.querySelector(`.empty .sr-only`)?.textContent).toBe(`Too many tries; try again in 6 s`);
        });
    });

    it('offer a retry when the directory fails', async () => {
        stubDirectory([], 500);
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByText(`The bot did not load`)).toBeTruthy();
        expect(screen.getByRole(`heading`, { level: 1, name: `sealbot` })).toBeTruthy();
        stubDirectory([sealbot]);
        fireEvent.click(screen.getByRole(`button`, { name: `Try again` }));
        await waitFor(() => {
            expect(screen.getByRole(`heading`, { name: `sealbot` })).toBeTruthy();
        });
    });

    it('show the owner panel to the owner alone', async () => {
        serveAs(`ana`, []);
        render(<BotScreen name="sealbot" />);
        await screen.findByRole(`heading`, { name: `sealbot` });
        await waitFor(() => {
            expect(meStore.read().status).toBe(`ready`);
        });
        expect(screen.queryByRole(`heading`, { name: `Owner tools` })).toBe(null);
        cleanup();
        serveAs(`quinn`, []);
        render(<BotScreen name="sealbot" />);
        expect(await screen.findByRole(`heading`, { name: `Owner tools` })).toBeTruthy();
    });

    it('rotate the token only on the second click and show the new one once', async () => {
        const writes: { method: string; url: string }[] = [];
        serveAs(`quinn`, writes);
        render(<BotScreen name="sealbot" />);
        fireEvent.click(await screen.findByRole(`button`, { name: `Rotate token` }));
        expect(writes).toEqual([]);
        fireEvent.click(screen.getByRole(`button`, { name: `Rotate; the old token stops now` }));
        expect(await screen.findByText(`hxo_${`c`.repeat(43)}`)).toBeTruthy();
        expect(writes).toEqual([{ method: `POST`, url: `/api/bots/sealbot/token` }]);
    });

    it('name the delete confirmation with a label on screen', async () => {
        serveAs(`quinn`, []);
        render(<BotScreen name="sealbot" />);
        const field = await screen.findByRole(`textbox`, { name: `Type sealbot to confirm` });
        expect(document.querySelector(`label[for="${field.id}"]`)?.textContent).toBe(`Type sealbot to confirm`);
        expect(field.getAttribute(`aria-label`)).toBe(null);
    });

    it('delete only after the name is typed, and explain a seated bot', async () => {
        const writes: { method: string; url: string }[] = [];
        serveAs(`quinn`, writes, 409);
        render(<BotScreen name="sealbot" />);
        const remove = await screen.findByRole(`button`, { name: `Delete sealbot` });
        expect(remove.hasAttribute(`disabled`)).toBe(true);
        fireEvent.change(screen.getByRole(`textbox`, { name: `Type sealbot to confirm` }), { target: { value: `sealbot` } });
        expect(remove.hasAttribute(`disabled`)).toBe(false);
        fireEvent.click(remove);
        expect(await screen.findByText(`sealbot is in a game; delete it once the game ends`)).toBeTruthy();
        expect(writes).toEqual([{ method: `DELETE`, url: `/api/bots/sealbot` }]);
    });

    it('hold rotate and delete for the wait a rate-limited change names', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string, init?: RequestInit) => {
                if ((init?.method ?? `GET`) !== `GET`) {
                    return Promise.resolve(
                        new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `42` } }),
                    );
                }
                const body = url === `/api/me` ? { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] } : [sealbot];
                return Promise.resolve(new Response(JSON.stringify(body)));
            }),
        );
        meStore.reset();
        meStore.start();
        render(<BotScreen name="sealbot" />);
        fireEvent.click(await screen.findByRole(`button`, { name: `Rotate token` }));
        const armed = screen.getByRole(`button`, { name: `Rotate; the old token stops now` });
        fireEvent.click(armed);
        const spoken = () => [...document.querySelectorAll(`.owner-row .field-error .sr-only`)].map((line) => line.textContent);
        await waitFor(() => {
            expect(spoken()).toEqual([`Too many tries; try again in 42 s`]);
        });
        expect(armed.hasAttribute(`disabled`)).toBe(true);
        fireEvent.change(screen.getByRole(`textbox`, { name: `Type sealbot to confirm` }), { target: { value: `sealbot` } });
        const remove = screen.getByRole(`button`, { name: `Delete sealbot` });
        fireEvent.click(remove);
        await waitFor(() => {
            expect(spoken()).toEqual([`Too many tries; try again in 42 s`, `Too many tries; try again in 42 s`]);
        });
        expect(remove.hasAttribute(`disabled`)).toBe(true);
    });

    it('show a board for every live game the bot plays, each a way into it, and nothing when it plays none', async () => {
        const live = [
            {
                gameId: `g-live`,
                players: {
                    x: { name: `sealbot`, rating: 1712, provisional: false, kind: `bot` },
                    o: { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` },
                },
                timeControl: { mode: `unlimited` },
                toMove: `o`,
                rated: false,
                cells: [{ x: 0, y: 0, side: `x` }],
                clock: { mode: `unlimited` },
            },
        ];
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) =>
                Promise.resolve(new Response(JSON.stringify(url === `/api/games` ? live : url === `/api/me` ? null : [sealbot]))),
            ),
        );
        render(<BotScreen name="sealbot" />);
        const playing = await screen.findByRole(`region`, { name: `Playing now` });
        const watch = within(playing).getByRole(`link`, { name: `Watch sealbot BOT vs Guest k3f9` });
        expect(watch.getAttribute(`href`)).toBe(`/game/g-live`);
        expect(within(playing).getByRole(`img`, { name: `Board, sealbot vs Guest k3f9, Guest k3f9 to move` })).toBeTruthy();
        expect(within(playing).getByRole(`heading`, { level: 3, name: `Watch sealbot BOT vs Guest k3f9` })).toBeTruthy();
        expect(playing.textContent).toContain(`unrated`);
        expect(playing.textContent).toContain(`Guest k3f9 to move`);
        cleanup();
        const others = [{ ...live[0], players: { ...live[0]?.players, x: { name: `hextide`, rating: 1690, provisional: false, kind: `bot` } } }];
        let listed = false;
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) => {
                if (url === `/api/games`) listed = true;
                return Promise.resolve(new Response(JSON.stringify(url === `/api/games` ? others : url === `/api/me` ? null : [sealbot])));
            }),
        );
        render(<BotScreen name="sealbot" />);
        await screen.findByRole(`heading`, { name: `sealbot` });
        await waitFor(() => {
            expect(listed).toBe(true);
        });
        expect(screen.queryByText(`Playing now`)).toBe(null);
    });
});
