import { expect, test, type Page } from '@playwright/test';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

async function open(page: Page, reportForm: boolean): Promise<void> {
    const ink = looks.find((look) => look.name === `ink`);
    if (ink === undefined) throw new Error(`no ink look registered`);
    await wear(page, ink);
    await serve(page, world({ me: null, reportForm }));
    await page.setViewportSize({ width: 1280, height: 900 });
}

test('with the report form on, the bot page and the footer lead to it, its page takes a report, and the privacy policy says what a report stores', async ({ page }) => {
    await open(page, true);
    await page.goto(`/bots/sealbot`);
    await expect(page.getByRole(`heading`, { level: 1, name: `sealbot` })).toBeVisible();
    await expect(page.getByRole(`link`, { name: `Report sealbot` })).toHaveAttribute(`href`, `/report?subject=%2Fbots%2Fsealbot`);
    const legal = page.locator(`footer.site-footer .legal-links`);
    await expect(legal).toHaveText(`Impressum / Legal noticePrivacyTermsLicensesReport`);
    await expect(legal.getByRole(`link`, { name: `Report` })).toHaveAttribute(`href`, `/report?subject=%2Fbots%2Fsealbot`);
    await page.goto(`/report?subject=%2Fbots%2Fsealbot`);
    await expect(page.locator(`.report-form`)).toBeVisible();
    await expect(page.getByRole(`button`, { name: `Send report` })).toBeVisible();
    await page.goto(`/legal/privacy`);
    await expect(page.getByRole(`heading`, { level: 2, name: `Reports` })).toBeVisible();
    await expect(page.getByRole(`link`, { name: `report form` })).toHaveAttribute(`href`, `/report`);
});

test('with the report form off, no page leads to it, its page is not found, and the legal texts send notices to the contact email', async ({ page }) => {
    await open(page, false);
    await page.goto(`/bots/sealbot`);
    await expect(page.getByRole(`heading`, { level: 1, name: `sealbot` })).toBeVisible();
    await expect(page.locator(`footer.site-footer .legal-links`)).toHaveText(`Impressum / Legal noticePrivacyTermsLicenses`);
    await expect(page.getByRole(`link`, { name: /^Report/u })).toHaveCount(0);
    await page.goto(`/report?subject=%2Fbots%2Fsealbot`);
    await expect(page.getByRole(`heading`, { level: 1, name: `Not found` })).toBeVisible();
    await expect(page).toHaveTitle(`Not found - HeXO Arena`);
    await expect(page.locator(`.report-form`)).toHaveCount(0);
    await page.goto(`/legal/privacy`);
    await expect(page.getByRole(`heading`, { level: 2, name: `Writing to the operator` })).toBeVisible();
    await expect(page.getByRole(`heading`, { level: 2, name: `Reports` })).toHaveCount(0);
    await expect(page.getByRole(`link`, { name: `report form` })).toHaveCount(0);
    await page.goto(`/legal/terms`);
    const reporting = page.locator(`section`).filter({ has: page.getByRole(`heading`, { level: 2, name: `Reporting` }) });
    await expect(reporting).toContainText(`Report unlawful content or abuse by writing to`);
    await expect(page.getByRole(`link`, { name: `report form` })).toHaveCount(0);
});
