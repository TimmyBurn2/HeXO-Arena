import { expect, test, type Locator, type Page } from '@playwright/test';
import { looks, wear } from './matrix';
import { keptNames, serve, tournamentGameRows, tournaments, world } from './mock-api';

async function open(page: Page, path: string, width = 1280): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ tournaments: tournaments() }));
    await page.goto(path);
}

test('an owner enters a bot in a waiting tournament and withdraws it', async ({ page }) => {
    await open(page, `/tournaments/t_wintercup202`);
    await expect(page.getByRole(`heading`, { name: `Entered (2 of 12)` })).toBeVisible();
    await page.getByLabel(`Your bot`).selectOption(`quietlake`);
    await page.getByRole(`button`, { name: `Enter`, exact: true }).click();
    await expect(page.getByText(`quietlake is entered.`)).toBeVisible();
    await expect(page.getByRole(`heading`, { name: `Entered (3 of 12)` })).toBeVisible();
    await page.getByRole(`button`, { name: `Withdraw` }).click();
    await expect(page.getByRole(`heading`, { name: `Entered (2 of 12)` })).toBeVisible();
});

test('the tournaments stand under Games, a tournament\'s page lighting Games with a crumb back, and the ladder alone', async ({ page }) => {
    await open(page, `/ladder`);
    await expect(page.getByRole(`navigation`, { name: `Ladder and tournaments` })).toHaveCount(0);
    await page.goto(`/tournaments`);
    await expect(page).toHaveURL(/\/games\/tournaments$/u);
    await expect(page.getByRole(`navigation`, { name: `Games` }).getByRole(`link`, { name: `Tournaments` })).toHaveAttribute(`aria-current`, `page`);
    await expect(page.getByRole(`heading`, { name: `Live` })).toBeVisible();
    await page.getByRole(`link`, { name: `Autumn round robin` }).click();
    await expect(page.getByText(`Round 2 of 3 is live.`)).toBeVisible();
    await expect(page.getByRole(`navigation`, { name: `Main` }).first().getByRole(`link`, { name: `Games` })).toHaveAttribute(`aria-current`, `page`);
    await page.locator(`.duel-kicker`).getByRole(`link`, { name: `Tournaments` }).click();
    await expect(page).toHaveURL(/\/games\/tournaments$/u);
});

for (const width of [1280, 390]) {
    test(`the tournaments name the reader's own part and offer an owner the entry of one coming up, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/games/tournaments`, width);
        const live = page.locator(`.tournament-row`, { has: page.getByRole(`link`, { name: `Autumn round robin` }) });
        await expect(live.locator(`.tournament-row-yours`)).toHaveText(`Yours: sealbot, 1st so far`);
        await expect(live.locator(`.tournament-row-live`)).toHaveText(`Round 2 of 3 live`);
        await page.getByRole(`link`, { name: `Enter a bot in Winter cup` }).click();
        await expect(page).toHaveURL(/\/tournaments\/t_wintercup202$/u);
        await expect(page.getByLabel(`Your bot`)).toBeVisible();
    });

    test(`Play's Tournament place enters a bot in the next weekly in place, beside a round robin's setup, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/play/tournament`, width);
        await expect(page.getByRole(`navigation`, { name: `Play` }).getByRole(`link`, { name: `Tournament` })).toHaveAttribute(`aria-current`, `page`);
        const weekly = page.getByRole(`region`, { name: `Weekly tournament` });
        await expect(weekly.getByRole(`link`, { name: `Winter cup` })).toBeVisible();
        await expect(weekly.getByText(/^Starts in 2 h 5\d min; 2 of 12 entered; turn clock 10 s$/u)).toBeVisible();
        // The entry stands as far under its note as on the tournament's page.
        const gapUnder = async (note: Locator) =>
            note.evaluate((element) => {
                const next = element.nextElementSibling;
                return next === null ? null : Math.round(next.getBoundingClientRect().top - element.getBoundingClientRect().bottom);
            });
        const gap = await gapUnder(weekly.locator(`.entry-control > .note`));
        expect(gap).toBeGreaterThanOrEqual(12);
        await weekly.getByLabel(`Your bot`).selectOption(`sealbot`);
        await weekly.getByRole(`button`, { name: `Enter`, exact: true }).click();
        await expect(weekly.getByText(`sealbot is entered.`)).toBeVisible();
        await expect(weekly.getByText(/; 3 of 12 entered; turn clock 10 s$/u)).toBeVisible();
        await expect(page.getByRole(`heading`, { name: `No duel or round robin possible right now` })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.goto(`/tournaments/t_wintercup202`);
        expect(await gapUnder(page.locator(`.entry-control > .note`))).toBe(gap);
    });

    test(`a tournament's page leads to its games under Games, a round picked there, at ${String(width)} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const look = looks[0];
        if (look === undefined) throw new Error(`no look registered`);
        await wear(page, look);
        await serve(page, world({ tournaments: tournaments(), finished: [...tournamentGameRows, ...keptNames] }));
        await page.goto(`/tournaments/t_autumnrobin1`);
        await page.getByRole(`link`, { name: `These games in Games` }).click();
        await expect(page).toHaveURL(/\/games\?event=tournament&tournament=t_autumnrobin1$/u);
        await expect(page.getByRole(`button`, { name: `Remove Autumn round robin` })).toBeVisible();
        await expect(page.locator(`.game-row`)).toHaveCount(1);
        await page.getByRole(`button`, { name: /^Filters/u }).click();
        await page.getByLabel(`Round`, { exact: true }).selectOption(`1`);
        await expect(page).toHaveURL(/\/games\?event=tournament&tournament=t_autumnrobin1&round=1$/u);
        await page.getByRole(`button`, { name: `Show games` }).click();
        await expect(page.getByRole(`heading`, { name: `No games match these filters` })).toBeVisible();
        await expect(page.getByText(`No finished game matches Autumn round robin, round 1.`)).toBeVisible();
    });
}

test('the crosstable scrolls inside its frame on a phone, the names held in place', async ({ page }) => {
    await open(page, `/tournaments/t_autumnrobin1`, 360);
    const frame = page.locator(`.xt-frame`);
    await frame.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
    });
    const name = await page.locator(`.xt tbody .xt-name`).first().boundingBox();
    const box = await frame.boundingBox();
    expect(Math.abs((name?.x ?? 0) - (box?.x ?? 0))).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a standings row opens its pairings from a 44 px target on a phone', async ({ page }) => {
    await open(page, `/tournaments/t_autumnrobin1`, 390);
    const box = await page.getByRole(`button`, { name: /^Pairings of /u }).first().boundingBox();
    expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
});

for (const width of [1280, 390]) {
    test(`a running tournament offers its games over so far as one download, and a waiting one nothing to download, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/tournaments/t_autumnrobin1`, width);
        const exported = page.getByRole(`link`, { name: `Export games` });
        await expect(exported).toHaveAttribute(`href`, `/api/tournaments/t_autumnrobin1/export`);
        // The browser downloads past the page's routes, so the server's own tests read the archive.
        await expect(exported).toHaveAttribute(`download`, ``);
        await open(page, `/tournaments/t_wintercup202`, width);
        await expect(page.getByRole(`heading`, { name: `Entered (2 of 12)` })).toBeVisible();
        await expect(page.getByRole(`link`, { name: `Export games` })).toHaveCount(0);
    });
}

for (const width of [1280, 390]) {
    test(`a tournament no link names reads Not found, as a missing duel does, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/tournaments/t_nosuchthing1`, width);
        await expect(page.getByRole(`heading`, { name: `Not found`, level: 1 })).toBeVisible();
        await expect(page.getByText(`No tournament has that link; see Tournaments.`)).toBeVisible();
        await expect(page).toHaveTitle(`Not found - HeXO Arena`);
        await expect(page.locator(`.duel-kicker`)).toHaveCount(0);
        await page.locator(`main`).getByRole(`link`, { name: `Tournaments` }).click();
        await expect(page).toHaveURL(/\/games\/tournaments$/u);
    });
}
