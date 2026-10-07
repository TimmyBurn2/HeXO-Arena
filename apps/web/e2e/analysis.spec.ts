import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { looks, wear } from './matrix';
import { longReadings, serve, world, type World } from './mock-api';

async function open(page: Page, path: string, overrides: Partial<World> = {}, width = 1280, height = 800): Promise<void> {
    await page.setViewportSize({ width, height });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world(overrides));
    await page.goto(path);
    await page.locator(`h1`).first().waitFor();
}

const cell = (page: Page, x: number, y: number) => page.locator(`.board-camera polygon.cell[data-x="${String(x)}"][data-y="${String(y)}"]`);
const stones = (page: Page) => page.locator(`.board-camera .board-svg g.stone`);
const navWords = (page: Page) => page.locator(`.an-chip-nav .scrub-words`);
const navLine = (page: Page) => page.locator(`.an-chip-nav .an-nav-line`);
const rows = (page: Page) => page.locator(`.an-tree .an-row:not(.an-opening) .an-move .sr-only`);
const currentRow = (page: Page) => page.locator(`.an-tree [aria-current="step"] .an-move .sr-only`);
const tokens = (page: Page) => page.locator(`.an-band .an-tok`);

async function playTurn(page: Page, first: readonly [number, number], second: readonly [number, number]): Promise<void> {
    await cell(page, ...first).click();
    await cell(page, ...second).click();
}

async function stored(page: Page): Promise<unknown> {
    return page.evaluate(() => JSON.parse(window.sessionStorage.getItem(`hexo-arena.analysis.v1`) ?? `null`) as unknown);
}

test('the bar names Analysis after Games, and a phone has six tabs until Home steps aside', async ({ page }) => {
    await open(page, `/analysis`);
    await expect(page.locator(`.nav-links .nav-link`)).toHaveText([`Play`, `Games`, `Analysis`, `Ladder`, `Bots`, `Build a bot`]);
    await expect(page.locator(`.nav-links .nav-link[aria-current="page"]`)).toHaveText(`Analysis`);
    await expect(page).toHaveTitle(`Analysis - HeXO Arena`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(`nav.tabbar a`)).toHaveText([`Home`, `Play`, `Games`, `Analysis`, `Ladder`, `Bots`]);
    await expect(page.locator(`nav.tabbar a[aria-current="page"]`)).toHaveText(`Analysis`);
    await page.setViewportSize({ width: 360, height: 740 });
    await expect(page.locator(`nav.tabbar a:visible`)).toHaveText([`Play`, `Games`, `Analysis`, `Ladder`, `Bots`]);
});

test('a new board plays turns for both sides, two clicks a turn, a click on the mark taking it back', async ({ page }) => {
    await open(page, `/analysis`, { me: null });
    await expect(page.locator(`.an-intro`)).toContainText(`Play turns for both sides from the origin`);
    await expect(navWords(page)).toHaveText(`Turn 0`);
    await expect(navLine(page)).toHaveText(`o to move`);
    await cell(page, 1, 0).click();
    await expect(page.locator(`.ring-pending`)).toHaveCount(1);
    await expect(navLine(page)).toHaveText(`o to move, 1 stone left`);
    await cell(page, 1, 0).click();
    await expect(page.locator(`.ring-pending`)).toHaveCount(0);
    await playTurn(page, [1, 0], [0, 1]);
    await expect(stones(page)).toHaveCount(3);
    await expect(rows(page)).toHaveText([`o: [1,0] [1,-1]`]);
    await expect(navWords(page)).toHaveText(`Turn 1`);
    await expect(navLine(page)).toHaveText(`x to move`);
    await expect(page.locator(`.last-ring`)).toHaveCount(2);
    await expect(page.locator(`.an-intro`)).toHaveCount(0);
    await cell(page, 0, 0).click();
    await expect(navLine(page)).toHaveText(`That cell is taken`);
});

test('the tree keeps variations, steps with the keys, and promotes, deletes, and copies a line', async ({ page }) => {
    await open(page, `/analysis`);
    await page.context().grantPermissions([`clipboard-read`, `clipboard-write`]);
    await playTurn(page, [1, 0], [0, 1]);
    await playTurn(page, [-1, 0], [0, -1]);
    await page.keyboard.press(`ArrowLeft`);
    await expect(navWords(page)).toHaveText(`Turn 1`);
    await playTurn(page, [2, 0], [3, 0]);
    await expect(navWords(page)).toHaveText(`Turn 2, a variation`);
    await expect(tokens(page).locator(`.an-move .sr-only`)).toHaveText([`x: [2,0] [3,0]`]);
    await page.keyboard.press(`ArrowUp`);
    await expect(currentRow(page)).toHaveText(`x: [-1,0] [-1,1]`);
    await page.keyboard.press(`ArrowDown`);
    await expect(currentRow(page)).toHaveText(`x: [2,0] [3,0]`);
    await page.keyboard.press(`Home`);
    await expect(navWords(page)).toHaveText(`Turn 0`);
    // Forward follows the line last visited, the variation.
    await page.keyboard.press(`End`);
    await expect(currentRow(page)).toHaveText(`x: [2,0] [3,0]`);

    await tokens(page).click({ button: `right` });
    await page.getByRole(`button`, { name: `Copy line` }).click();
    await expect(page.locator(`.an-status`)).toHaveText(`Line copied as HTTTX notation`);
    expect(await page.evaluate(async () => navigator.clipboard.readText())).toBe(`version[1];\n1. [1,0][1,-1];\n2. [2,0][3,0];\n`);

    await page.getByRole(`button`, { name: `More for turn 2` }).click();
    await page.getByRole(`button`, { name: `Promote to main line` }).click();
    await expect(rows(page)).toHaveText([`o: [1,0] [1,-1]`, `x: [2,0] [3,0]`]);
    await expect(tokens(page).locator(`.an-move .sr-only`)).toHaveText([`x: [-1,0] [-1,1]`]);
    await expect(navWords(page)).toHaveText(`Turn 2`);
    await tokens(page).click({ button: `right` });
    await page.getByRole(`button`, { name: `Delete from here` }).click();
    await expect(page.locator(`.an-band`)).toHaveCount(0);
    await expect(rows(page)).toHaveText([`o: [1,0] [1,-1]`, `x: [2,0] [3,0]`]);
});

test('the board is walked and played from the keyboard once it is reached from the keyboard', async ({ page }) => {
    await open(page, `/analysis`);
    await page.getByRole(`application`).focus();
    await page.keyboard.press(`ArrowRight`);
    await page.keyboard.press(`Enter`);
    await expect(page.locator(`.ring-pending`)).toHaveCount(1);
    await page.keyboard.press(`ArrowRight`);
    await page.keyboard.press(`Enter`);
    await expect(rows(page)).toHaveText([`o: [1,0] [2,0]`]);
    // A press on the board leaves the arrows to the turns.
    await cell(page, 0, 1).click();
    await page.keyboard.press(`ArrowLeft`);
    await expect(navWords(page)).toHaveText(`Turn 0`);
    await expect(page.locator(`.ring-pending`)).toHaveCount(0);
});

test('a first stone that completes six ends the turn and the line', async ({ page }) => {
    await open(page, `/analysis#b=xxxxx/o&m=x`);
    await expect(page.locator(`.an-chip-source`)).toContainText(`From a set-up position`);
    await expect(page).toHaveURL(/\/analysis$/u);
    await cell(page, 5, 0).click();
    await expect(page.locator(`polyline.win-line`)).toHaveCount(1);
    await expect(navLine(page)).toHaveText(`x won with six in a row`);
    await expect(rows(page)).toHaveText([`x: [5,0]`]);
    await cell(page, 2, 2).click();
    await expect(navLine(page)).toHaveText(`This line is won; step back to play another turn`);
});

test('a link whose line does not read says why and opens the board as it was', async ({ page }) => {
    await open(page, `/analysis#t=1.[0,0][1,0];`);
    await expect(page.locator(`.an-panel [role="alert"] .an-error`)).toHaveText(`This link did not load`);
    await expect(page.locator(`.an-panel [role="alert"] .note`)).toHaveText(`Turn 1, [0,0]: that cell is taken`);
    await expect(navWords(page)).toHaveText(`Turn 0`);
    await playTurn(page, [1, 0], [0, 1]);
    await expect(page.locator(`.an-panel [role="alert"]`)).toHaveCount(0);
});

test('a finished game opens at the linked turn, its opening one row, its game one press away', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=12`);
    await expect(navWords(page)).toHaveText(`Turn 12 of 25`);
    await expect(page).toHaveTitle(`Analysis: hextide vs quietlake - HeXO Arena`);
    await expect(page.locator(`.an-chip-source`)).toContainText(`quietlake won with six in a row`);
    await expect(page.locator(`.an-chip-source`).getByRole(`link`, { name: `Open the game` })).toHaveAttribute(`href`, `/game/long-finished?turn=12`);
    await expect(page.locator(`.an-opening .an-row-go`)).toHaveAccessibleName(/^opening, turns 0 to 2, x: \[0,0\] o: /u);
    await expect(page).toHaveURL(/\/analysis\?game=long-finished$/u);
    await page.keyboard.press(`Home`);
    await expect(navWords(page)).toHaveText(`Opening, 5 stones`);
    await page.keyboard.press(`ArrowLeft`);
    await expect(navWords(page)).toHaveText(`Opening, 5 stones`);
    await page.keyboard.press(`End`);
    await expect(navWords(page)).toHaveText(`Turn 25 of 25`);
    await expect(navLine(page)).toHaveText(`o won with six in a row`);
    await expect(page.locator(`polyline.win-line`)).toHaveCount(1);
});

test('a game\'s own turns stay in the tree while its variations can go', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=3`);
    await page.locator(`.an-tree [aria-current="step"]`).click({ button: `right` });
    const menu = page.getByRole(`group`, { name: `Turn 3` });
    await expect(menu.getByRole(`button`)).toHaveText([`Copy line`]);
    await page.keyboard.press(`Escape`);
    await expect(menu).toHaveCount(0);
    await playTurn(page, [3, 3], [3, 4]);
    await tokens(page).click({ button: `right` });
    await expect(page.getByRole(`group`, { name: `Turn 4` }).getByRole(`button`)).toHaveText([`Promote to main line`, `Delete from here`, `Copy line`]);
    const axe = await new AxeBuilder({ page }).withRules([`list`, `listitem`, `aria-allowed-role`, `target-size`]).analyze();
    expect(axe.violations.flatMap((violation) => violation.nodes.map((node) => node.target))).toEqual([]);
    await page.getByRole(`button`, { name: `Delete from here` }).click();
    await expect(page.locator(`.an-band`)).toHaveCount(0);
    await expect(navWords(page)).toHaveText(`Turn 3 of 25`);
});

test('a game opened again in the tab keeps its variations, stored by its id and their own cells alone', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=3`);
    await playTurn(page, [3, 3], [3, 4]);
    await expect(navWords(page)).toHaveText(`Turn 4, a variation`);
    expect(await stored(page)).toMatchObject({ root: { kind: `game`, gameId: `long-finished` } });
    const nodes = ((await stored(page)) as { nodes: { c?: unknown }[] }).nodes;
    expect(nodes.filter((node) => node.c !== undefined)).toEqual([{ p: 2, c: [[3, 3], [3, 4]] }]);
    await page.goto(`/analysis`);
    await expect(navWords(page)).toHaveText(`Turn 4, a variation`);
    await expect(page).toHaveURL(/\/analysis\?game=long-finished$/u);
    await page.getByRole(`button`, { name: `New board` }).click();
    await page.getByRole(`button`, { name: `New board; this tree is replaced` }).click();
    await expect(navWords(page)).toHaveText(`Turn 0`);
    await expect(page).toHaveURL(/\/analysis$/u);
});

test('a live game waits for its end and an unknown one reads as missing', async ({ page }) => {
    await open(page, `/analysis?game=running`);
    await expect(page.getByRole(`heading`, { name: `This game is live` })).toBeVisible();
    await expect(page.getByText(`Analysis opens once it ends.`)).toBeVisible();
    await expect(page.getByRole(`link`, { name: `Watch the game` })).toHaveAttribute(`href`, `/game/running`);
    await page.goto(`/analysis?game=nope`);
    await expect(page.getByRole(`heading`, { name: `No such game` })).toBeVisible();
    await page.getByRole(`button`, { name: `New board` }).click();
    await expect(navWords(page)).toHaveText(`Turn 0`);
});

test('Set up places and takes off stones, names the side to move, checks the board, and starts a tree there', async ({ page }) => {
    await open(page, `/analysis`);
    // The board's keys listen from the same effects that keep the board, so a key pressed before it is kept goes unheard.
    await expect.poll(() => stored(page)).not.toBeNull();
    await page.keyboard.press(`s`);
    const panel = page.locator(`.an-tools`);
    await expect(panel.getByRole(`heading`, { name: `Set up a position` })).toBeFocused();
    await page.keyboard.press(`Escape`);
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole(`button`, { name: `Set up` })).toBeFocused();
    await page.getByRole(`button`, { name: `Set up` }).click();
    await panel.getByRole(`button`, { name: `Cancel` }).click();
    await expect(page.getByRole(`button`, { name: `Set up` })).toBeFocused();
    await page.keyboard.press(`s`);
    await expect(navWords(page)).toHaveText(`Setup`);
    await expect(panel.locator(`.an-check`)).toContainText(`1 stone: 1 x, 0 o; o to move`);
    await panel.getByRole(`button`, { name: `Clear` }).click();
    await expect(panel.locator(`.an-check`)).toContainText(`No stones on the board; place at least one`);
    await expect(panel.getByRole(`button`, { name: `Done` })).toHaveAttribute(`aria-disabled`, `true`);
    await panel.getByRole(`button`, { name: `Undo` }).click();
    await panel.getByRole(`button`, { name: `o stone` }).click();
    await cell(page, 2, 0).click();
    await cell(page, 3, 0).click();
    await cell(page, 3, 0).click();
    await panel.getByRole(`button`, { name: `x`, exact: true }).click();
    await expect(panel.locator(`.an-check`)).toContainText(`2 stones: 1 x, 1 o; x to move`);
    await expect(panel.locator(`.an-check`)).toContainText(`Ready`);
    await expect(panel).toContainText(`Done starts a new tree at this position; this tree is replaced.`);
    await panel.getByRole(`button`, { name: `Done` }).click();
    await expect(page.getByRole(`button`, { name: `Set up` })).toBeFocused();
    await expect(page.locator(`.an-chip-source`)).toContainText(`From a set-up position`);
    await expect(navLine(page)).toHaveText(`x to move`);
    await expect(stones(page)).toHaveCount(2);
});

test('Import previews pasted text, names the turn and cell it refuses, and loads', async ({ page }) => {
    await open(page, `/analysis`);
    const importButton = page.getByRole(`button`, { name: `Import` });
    await importButton.click();
    await page.getByRole(`dialog`, { name: `Import` }).getByRole(`button`, { name: `Cancel` }).click();
    await expect(importButton).toBeFocused();
    await importButton.click();
    await page.mouse.click(4, 4);
    await expect(page.getByRole(`dialog`, { name: `Import` })).toHaveCount(0);
    await expect(importButton).toBeFocused();
    await page.getByRole(`button`, { name: `Import` }).click();
    const dialog = page.getByRole(`dialog`, { name: `Import` });
    const field = dialog.getByRole(`textbox`, { name: `HTTTX notation, a position, or a game link` });
    await expect(field).toBeFocused();
    await field.fill(`version[1];\n1. [0,0][1,-2];\n`);
    await expect(dialog.locator(`.an-error`)).toHaveText(`Turn 1, [0,0]: that cell is taken`);
    await expect(dialog.getByRole(`button`, { name: `Load` })).toHaveAttribute(`aria-disabled`, `true`);
    await field.fill(`https://hexo.did.science/games/abc123`);
    await expect(dialog.locator(`.an-error`)).toHaveText(`hexo.did.science does not share games with other sites yet; copy the game there as HTTTX and paste it here.`);
    await field.fill(`version[1];\n1. [1,0][1,-2];\n2. [-1,1][0,2];\n3. [-1,-1][2,1];\n4. [0,1][-1,0];\n`);
    await expect(dialog.locator(`.an-preview`)).toContainText(`A game line, 4 turns`);
    await expect(dialog.locator(`.an-preview`)).toContainText(`Every turn is legal from the origin; o to move.`);
    await dialog.getByRole(`button`, { name: `Load` }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole(`button`, { name: `Import` })).toBeFocused();
    await expect(rows(page)).toHaveCount(4);
    await expect(navWords(page)).toHaveText(`Turn 4`);
});

test('Import opens a hexo.tyto.cc line mid-turn, a position with its side to move, and a game of this site', async ({ page }) => {
    await open(page, `/analysis`);
    await page.getByRole(`button`, { name: `Import` }).click();
    let dialog = page.getByRole(`dialog`, { name: `Import` });
    await dialog.getByRole(`textbox`).fill(`https://hexo.tyto.cc/#a=1.0`);
    await expect(dialog.locator(`.an-preview`)).toContainText(`o to move, 1 stone left`);
    await dialog.getByRole(`button`, { name: `Load` }).click();
    await expect(page.locator(`.ring-pending`)).toHaveCount(1);
    await expect(navLine(page)).toHaveText(`o to move, 1 stone left`);

    await page.getByRole(`button`, { name: `Import` }).click();
    dialog = page.getByRole(`dialog`, { name: `Import` });
    await dialog.getByRole(`textbox`).fill(`x.o/oxx`);
    await expect(dialog.locator(`.an-preview`)).toContainText(`A position, 5 stones`);
    await dialog.getByRole(`button`, { name: `x to move` }).click();
    await dialog.getByRole(`button`, { name: `Load` }).click();
    await expect(navLine(page)).toHaveText(`x to move`);
    await expect(stones(page)).toHaveCount(5);

    await page.getByRole(`button`, { name: `Import` }).click();
    dialog = page.getByRole(`dialog`, { name: `Import` });
    await dialog.getByRole(`textbox`).fill(`${new URL(page.url()).origin}/game/long-finished?turn=5`);
    await expect(dialog.locator(`.an-preview-text`)).toContainText(`Load opens it at turn 5.`);
    await dialog.getByRole(`button`, { name: `Load` }).click();
    await expect(navWords(page)).toHaveText(`Turn 5 of 25`);
});

test('a paste on the board opens Import with the pasted text', async ({ page }) => {
    await open(page, `/analysis`);
    await page.context().grantPermissions([`clipboard-read`, `clipboard-write`]);
    await page.evaluate(async () => navigator.clipboard.writeText(`version[1];\n1. [1,0][1,-2];\n`));
    await cell(page, 3, 3).click();
    await cell(page, 3, 3).click();
    await page.keyboard.press(`ControlOrMeta+V`);
    const dialog = page.getByRole(`dialog`, { name: `Import` });
    await expect(dialog.getByRole(`textbox`)).toHaveValue(`version[1];\n1. [1,0][1,-2];\n`);
    await page.keyboard.press(`Escape`);
    await expect(dialog).toHaveCount(0);
});

test('Export gives the line as HTTTX, the position as boat with its side to move, and a link that opens it', async ({ page }) => {
    await open(page, `/analysis`);
    await playTurn(page, [1, 0], [0, 1]);
    await playTurn(page, [-1, 0], [0, -1]);
    await page.getByRole(`button`, { name: `Export` }).click();
    const dialog = page.getByRole(`dialog`, { name: `Export` });
    await expect(dialog.getByRole(`textbox`, { name: `The tree from the origin, HTTTX v2 (2 turns)` })).toHaveValue(`version[2];\n1. [1,0][1,-1];\n2. [-1,0][-1,1];\n`);
    await expect(dialog.getByRole(`textbox`, { name: `This position, boat notation; o to move` })).toHaveValue(`.x/xxo/.o`);
    const link = await dialog.getByRole(`textbox`, { name: `Link to this line` }).inputValue();
    expect(link).toBe(`${new URL(page.url()).origin}/analysis#t=1.[1,0][1,-1];2.[-1,0][-1,1];`);
    await dialog.getByRole(`button`, { name: `Close` }).click();
    await expect(page.getByRole(`button`, { name: `Export` })).toBeFocused();
    await page.getByRole(`button`, { name: `New board` }).click();
    await page.getByRole(`button`, { name: `New board; this tree is replaced` }).click();
    await page.goto(link);
    await expect(rows(page)).toHaveText([`o: [1,0] [1,-1]`, `x: [-1,0] [-1,1]`]);
});

// A v2 study: clocks after each stone, evaluations after each turn, a variation ending on a half-turn,
// and the last turn's highlights, neutral, x, and o, and labels on empty cells and on both sides' stones.
const study = `version[2]name[Study]playercross[BlueWhale]playercircle[GreenSnake];
1. [-1,0]{@4505}[0,-1]{@4500:%-1};
2. [1,0]{@4055}[2,0]{@4050:%2}
  (2. [1,-2][2,-2]; 3. [-1,-1][/];);
3. [1,-2]{@4205}[2,-3]{@4200:%-5};
4. [3,0]{@3555}[4,0]{@3550:%38}<3,-4:#N><-2,1:#><5,0:#X:$A><-1,1:#O:$B><0,0:$1><1,0:$2><0,-1:$3>;
`;

async function importStudy(page: Page): Promise<void> {
    await page.getByRole(`button`, { name: `Import` }).click();
    const dialog = page.getByRole(`dialog`, { name: `Import` });
    await dialog.getByRole(`textbox`).fill(study);
    await expect(dialog.locator(`.an-preview`)).toContainText(`A game line, 4 turns, and 1 variation`);
    await expect(dialog.locator(`.an-preview`)).toContainText(`BlueWhale vs GreenSnake`);
    await expect(dialog.locator(`.an-preview`)).toContainText(`Its clocks, evaluations, highlights, and labels show as the text's own.`);
    await dialog.getByRole(`button`, { name: `Load` }).click();
    await expect(dialog).toHaveCount(0);
}

for (const [width, height] of [
    [1280, 800],
    [390, 844],
] as const) {
    test(`Import reads v2 text at ${String(width)} px: its variation, a half-turn its second stone completes, and the text's notes, named as its own`, async ({ page }) => {
        await open(page, `/analysis`, {}, width, height);
        await importStudy(page);
        await expect(rows(page)).toHaveCount(4);
        const notes = page.locator(`.an-notes`);
        await expect(notes).toContainText(`From the imported text`);
        const said = notes.locator(`.an-notes-row`);
        await expect(said).toHaveCount(3);
        await expect(said.nth(0)).toHaveText(`After [3,0]: 3.5 s left`);
        await expect(said.nth(1).locator(`.an-notes-value`)).toHaveText(`x 69%`);
        await expect(said.nth(1)).toContainText(`x's win chance 69 percent; 3.5 s left`);
        await expect(said.nth(2).locator(`[aria-hidden="true"]`)).toHaveText(`Highlights and labels on the board`);
        await expect(said.nth(2).locator(`.sr-only`)).toHaveText(
            `Highlights on the board: [3,-4] and [-2,1] neutral; [5,0] in x's color; [-1,1] in o's color. Labels: A on [5,0], B on [-1,1], 1 on [0,0], 2 on [1,0], 3 on [0,-1].`,
        );
        const source = page.locator(`.an-source`).filter({ visible: true });
        await expect(source.locator(`.an-source-title`)).toHaveText(`Study`);
        await expect(source.locator(`.an-source-note`)).toHaveText(`BlueWhale vs GreenSnake; from the origin, play both sides`);
        await expect(page.locator(`.an-evalbar-imported .an-evalbar-chip`)).toHaveText(`Imported: x 69%`);
        await expect(page.locator(`.board-camera .highlight`)).toHaveCount(4);
        await expect(page.locator(`.board-camera .highlight.hl-x`)).toHaveCount(1);
        await expect(page.locator(`.board-camera .highlight.hl-o`)).toHaveCount(1);
        await expect(page.locator(`.board-camera .visual-label`)).toHaveText([`A`, `B`, `1`, `2`, `3`]);
        await expect(page.locator(`.an-tree .an-row .an-move-clock`)).toHaveText([`4.5 s left`, `4.0 s left`, `4.2 s left`, `3.5 s left`]);
        await page.keyboard.press(`ArrowLeft`);
        await expect(page.locator(`.board-camera .visual-label`)).toHaveCount(0);
        await expect(said).toHaveCount(2);
        await expect(said.nth(1).locator(`.an-notes-value`)).toHaveText(`o 53%`);

        // The variation's whole turn is read; the half-turn after it is not, and offers no line to play.
        await page.locator(`.an-band .an-tok`).nth(0).click();
        await page.getByRole(`switch`, { name: `Analyze` }).check();
        await page.locator(`button.an-line`).first().waitFor();
        await page.locator(`.an-band .an-tok`).nth(1).click();
        await expect(page.locator(`.an-band .an-tok`).nth(1)).toContainText(`[/]`);
        await expect(page.locator(`.board-camera .line-mark`)).toHaveCount(0);
        await expect(page.locator(`.an-evalbar`)).toHaveCount(0);
        await expect(navLine(page)).toHaveText(`o to move, 1 stone left`);
        await expect(page.locator(`.an-notes`)).toHaveCount(0);
        await expect(page.locator(`.an-win-who`)).toHaveText(`o has a stone left after [-1,-1]; positions are read after whole turns.`);
        await expect(page.locator(`button.an-line`)).toHaveCount(0);
        await page.getByRole(`button`, { name: `Export` }).click();
        const exported = page.getByRole(`dialog`, { name: `Export` });
        await expect(exported.getByRole(`textbox`, { name: `The position before [-1,-1], boat notation; o to move` })).toBeVisible();
        await expect(exported.getByRole(`textbox`, { name: `Link to this line before [-1,-1]` })).toBeVisible();
        await exported.getByRole(`button`, { name: `Close` }).click();
        await page.getByRole(`button`, { name: `Set up` }).click();
        await expect(page.locator(`.an-tools`)).toContainText(`The lone stone on [-1,-1] stays; a set-up position starts a whole turn, so o places two stones after it.`);
        await expect(stones(page)).toHaveCount(6);
        await page.locator(`.an-tools`).getByRole(`button`, { name: `Cancel` }).click();
        await cell(page, -3, 1).click();
        await expect(navLine(page)).toHaveText(`x to move`);
        await expect(tokens(page)).toHaveCount(3);
    });
}

test('Import refuses v1 threat marks and a v2 turn after the final move, naming where', async ({ page }) => {
    await open(page, `/analysis`);
    await page.getByRole(`button`, { name: `Import` }).click();
    const dialog = page.getByRole(`dialog`, { name: `Import` });
    const field = dialog.getByRole(`textbox`);
    await field.fill(`version[1];\n1. [1,0][1,-2]!;\n`);
    await expect(dialog.locator(`.an-error`)).toHaveText(`Line 2, column 15, turn 1: ! threat marks are not read here; delete them and paste again`);
    await field.fill(`version[1]playercross[Ada]playercircle[Bo];\n1. [1,0][1,-2];\n`);
    await expect(dialog.locator(`.an-preview`)).toContainText(`A game line, 1 turn`);
    await expect(dialog.locator(`.an-preview`)).toContainText(`Ada vs Bo`);
    await field.fill(`version[2];\n1. [1,a][1,-2];\n`);
    await expect(dialog.locator(`.an-error`)).toHaveText(`Line 2, column 7, turn 1: a cell's two whole numbers, as in [1,-2] belongs here`);
    await field.fill(`version[2];\n1. [1,0][0,1];\n2. [2,0][/];\n3. [3,0][4,0];\n`);
    await expect(dialog.locator(`.an-error`)).toHaveText(`Line 4, column 1: turn 2 ends its line with [/], so no turn follows it there`);
    await field.fill(`version[3];\n1. [1,0][0,1];\n`);
    await expect(dialog.locator(`.an-error`)).toHaveText(`This text is version 3; versions 1 and 2 read here`);
});

for (const [width, height] of [
    [1280, 800],
    [390, 844],
] as const) {
    test(`Export writes the tree as v2 with its notes and tags, and v1 with the main line alone, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/analysis`, {}, width, height);
        await importStudy(page);
        await page.getByRole(`button`, { name: `Export` }).click();
        const dialog = page.getByRole(`dialog`, { name: `Export` });
        await expect(dialog.getByRole(`button`, { name: `HTTTX v2` })).toHaveAttribute(`aria-pressed`, `true`);
        await expect(dialog.getByRole(`textbox`, { name: `The tree from the origin, HTTTX v2 (4 turns, 1 variation)` })).toHaveValue(study);
        await expect(dialog.getByRole(`checkbox`, { name: `Evaluations from the reading shown (none yet; turn on Analyze to have positions read)` })).toBeDisabled();
        await expect(dialog.getByRole(`checkbox`, { name: /Clocks/u })).toHaveCount(0);
        await dialog.getByRole(`button`, { name: `HTTTX v1` }).click();
        await expect(dialog.getByRole(`textbox`, { name: `The main line from the origin, HTTTX v1 (4 turns)` })).toHaveValue(
            `version[1]name[Study]playercross[BlueWhale]playercircle[GreenSnake];\n1. [-1,0][0,-1];\n2. [1,0][2,0];\n3. [1,-2][2,-3];\n4. [3,0][4,0];\n`,
        );
        await expect(dialog.getByRole(`checkbox`)).toHaveCount(0);
        const link = await dialog.getByRole(`textbox`, { name: `Link to this line` }).inputValue();
        expect(link).toBe(`${new URL(page.url()).origin}/analysis#t=1.[-1,0][0,-1];2.[1,0][2,0];3.[1,-2][2,-3];4.[3,0][4,0];`);
    });
}

test('Export of a stored game adds its clocks and the reading shown\'s evaluations on request', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=12`, { analyses: { 'long-finished': { analyses: [longReadings.kestrel, ...longReadings.own], optedOut: false, independentOnline: false } } });
    await page.locator(`.an-win-graph .graph`).waitFor();
    await page.getByRole(`button`, { name: `Export` }).click();
    const dialog = page.getByRole(`dialog`, { name: `Export` });
    const field = dialog.getByRole(`textbox`, { name: /^The tree from the origin, HTTTX v2/u });
    await expect(field).toHaveValue(/^version\[2\]platform\[HeXO Arena\]playercross\[hextide\]playercircle\[quietlake\]endreason\[win\]winner\[circle\];\n1\. \[[-0-9,]+\]\[[-0-9,]+\];\n/u);
    expect(await field.inputValue()).not.toContain(`{`);
    await dialog.getByRole(`checkbox`, { name: `Clocks from the game (23 turns)` }).check();
    await expect(field).toHaveValue(/\n3\. \[[-0-9,]+\]\[[-0-9,]+\]\{@29000\};\n4\. \[[-0-9,]+\]\[[-0-9,]+\]\{@28000\};\n/u);
    const evaluations = dialog.getByRole(`checkbox`, { name: /^Evaluations from the reading shown, where the text gives none \(\d+ turns\)$/u });
    await evaluations.check();
    await expect(field).toHaveValue(/\n3\. \[[-0-9,]+\]\[[-0-9,]+\]\{@29000:[%#]-?\d+\};\n/u);
});

// Where the eval bar's chip stands: whether it shows, and which of the plates over the board it covers.
async function chipCovers(page: Page): Promise<{ readonly shown: boolean; readonly covers: string[] }> {
    return page.evaluate(() => {
        const visible = (element: Element | null): element is Element => element !== null && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== `hidden`;
        const chip = document.querySelector(`.an-evalbar-chip`);
        if (!visible(chip)) return { shown: false, covers: [] };
        const box = chip.getBoundingClientRect();
        const covers = [`.an-chip-source`, `.an-chip-nav`].filter((selector) => {
            const plate = document.querySelector(selector);
            if (!visible(plate)) return false;
            const other = plate.getBoundingClientRect();
            return box.left < other.right && other.left < box.right && box.top < other.bottom && other.top < box.bottom;
        });
        return { shown: true, covers };
    });
}

for (const { name, width, height, size } of [
    { name: `1280 px`, width: 1280, height: 800, size: 16 },
    { name: `390 px`, width: 390, height: 844, size: 16 },
    { name: `1280 px at 200% text`, width: 1280, height: 800, size: 32 },
    { name: `1440 px at 200% text`, width: 1440, height: 900, size: 32 },
] as const) {
    test(`the eval bar's chip covers neither the source plate nor the steps at x's win, o's win, and an even value, at ${name}`, async ({ page }) => {
        await open(page, `/analysis`, { analyses: { 'long-finished': { analyses: [longReadings.kestrel, ...longReadings.own], optedOut: false, independentOnline: false } } }, width, height);
        const devtools = await page.context().newCDPSession(page);
        await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
        for (const [value, chip] of [
            [`#1`, `Imported: x wins in 1`],
            [`#-1`, `Imported: o wins in 1`],
            [`%0`, `Imported: even`],
        ] as const) {
            await page.getByRole(`button`, { name: `Import` }).click();
            const dialog = page.getByRole(`dialog`, { name: `Import` });
            await dialog.getByRole(`textbox`).fill(`version[2];\n1. [1,0][0,1]{${value}};\n2. [-1,0][0,-1];\n3. [2,0][3,0]{${value}};\n`);
            await dialog.getByRole(`button`, { name: `Load` }).click();
            await expect(page.locator(`.an-evalbar-chip`)).toHaveText(chip);
            await expect.poll(async () => (await chipCovers(page)).covers).toEqual([]);
            if (width === 1280 && size === 16) expect((await chipCovers(page)).shown).toBe(true);
        }
        // An analyzer's chip stands where the bar does, here at o's edge for a forced win.
        await page.goto(`/analysis?game=long-finished&turn=22`);
        await expect(page.locator(`.an-evalbar-chip`)).toHaveText(`o wins in 1`);
        await expect.poll(async () => (await chipCovers(page)).covers).toEqual([]);
    });
}

test('a finished game opens in Analysis from its result chip and its Game tab, at the turn on screen', async ({ page }) => {
    // The finished fixture's id is the history's own path, so its twin opens here.
    await open(page, `/game/won`);
    const chipLink = page.locator(`.hud-bottom-center`).getByRole(`link`, { name: `Open in Analysis` });
    await expect(chipLink).toHaveAttribute(`href`, `/analysis?game=won&turn=6`);
    await page.keyboard.press(`ArrowLeft`);
    await expect(chipLink).toHaveAttribute(`href`, `/analysis?game=won&turn=5`);
    await page.getByRole(`button`, { name: `Game panel` }).click();
    await page.getByRole(`tab`, { name: `Game` }).click();
    await expect(page.locator(`#drawer-panel-game`).getByRole(`link`, { name: `Open in Analysis` })).toHaveAttribute(`href`, `/analysis?game=won&turn=5`);
    await chipLink.click();
    await expect(navWords(page)).toHaveText(`Turn 5 of 6`);
    await expect(page.locator(`.an-chip-source`)).toContainText(`quinn won with six in a row`);
});

test('a running game offers no way to Analysis', async ({ page }) => {
    await open(page, `/game/waiting`);
    await page.locator(`svg polygon.cell`).first().waitFor();
    await expect(page.getByRole(`link`, { name: `Open in Analysis` })).toHaveCount(0);
});

test('on a phone the steps sit under the board and the source heads the panel', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=12`, {}, 390, 844);
    await expect(page.locator(`.an-chip-nav`)).toBeHidden();
    const steps = page.locator(`.an-phone-nav`);
    await expect(steps.locator(`.scrub-words`)).toHaveText(`Turn 12 of 25`);
    await steps.getByRole(`button`, { name: `Go back a turn` }).click();
    await expect(steps.locator(`.scrub-words`)).toHaveText(`Turn 11 of 25`);
    await expect(page.locator(`.an-phone-source`)).toContainText(`hextide`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
