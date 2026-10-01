import { devAccountSchema, devAccountsPath, devLoginPath, type DevAccount } from '@hexo-arena/contract';
import { ApiError } from '../api/client';

/** The seeded personas, or null when the server has no dev routes. */
export async function fetchDevAccounts(): Promise<DevAccount[] | null> {
    const response = await fetch(devAccountsPath, { headers: { accept: `application/json` }, cache: `no-store` });
    if (response.status !== 200) return null;
    return devAccountSchema.array().parse(await response.json());
}

async function failureOf(response: Response): Promise<ApiError> {
    const body: unknown = await response.json().catch(() => null);
    const code = typeof body === `object` && body !== null && `code` in body && typeof body.code === `string` ? body.code : null;
    return new ApiError(response.status, code, `the dev login answered ${String(response.status)}`);
}

/** Signs a name in at once, making the account when it is new. */
export async function devSignIn(name: string): Promise<void> {
    const response = await fetch(devLoginPath, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ name }),
    });
    if (!response.ok) throw await failureOf(response);
}

/**
 * Comes back as a Discord account the site has never seen would: the
 * server holds the sign-up behind its cookie and points at the name page.
 * The redirect is not followed, so the page itself moves on.
 */
export async function devFirstSignIn(next: string): Promise<void> {
    const username = `newcomer.${Math.random().toString(36).slice(2, 6)}`;
    const response = await fetch(devLoginPath, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ discord: { username, displayName: null }, next }),
        redirect: `manual`,
    });
    if (response.type !== `opaqueredirect` && !response.ok) throw await failureOf(response);
}
