import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { guestIdleSeconds, GuestSessions } from '../src/guests';

describe('GuestSessions', () => {
    let seated: Set<string>;
    let ended: string[];
    let guests: GuestSessions;

    beforeEach(() => {
        vi.useFakeTimers({ toFake: [`Date`] });
        seated = new Set();
        ended = [];
        guests = new GuestSessions({
            seated: (guestId) => seated.has(guestId),
            ended: (guestId) => {
                ended.push(guestId);
            },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('labels guests outside the name syntax and keeps live labels distinct', () => {
        const names = new Set<string>();
        for (let minted = 0; minted < 200; minted += 1) {
            const fresh = guests.mint();
            if (fresh === null) throw new Error(`cap reached early`);
            expect(fresh.guest.name).toMatch(/^Guest [a-z0-9]{4}$/);
            names.add(fresh.guest.name);
        }
        expect(names.size).toBe(200);
    });

    it('renews the idle window on every lookup', () => {
        const fresh = guests.mint();
        if (fresh === null) throw new Error(`no guest`);
        vi.setSystemTime(Date.now() + (guestIdleSeconds - 1) * 1000);
        expect(guests.find(fresh.token)?.id).toBe(fresh.guest.id);
        vi.setSystemTime(Date.now() + (guestIdleSeconds - 1) * 1000);
        expect(guests.find(fresh.token)?.id).toBe(fresh.guest.id);
    });

    it('never expires a guest seated in a live game', () => {
        const fresh = guests.mint();
        if (fresh === null) throw new Error(`no guest`);
        seated.add(fresh.guest.id);
        vi.setSystemTime(Date.now() + guestIdleSeconds * 2000);
        expect(guests.find(fresh.token)?.id).toBe(fresh.guest.id);
        expect(ended).toEqual([]);
    });

    it('reports every ended guest once, whether idle or signed out', () => {
        const idle = guests.mint();
        const leaving = guests.mint();
        if (idle === null || leaving === null) throw new Error(`no guest`);
        guests.end(leaving.token);
        guests.end(leaving.token);
        vi.setSystemTime(Date.now() + guestIdleSeconds * 1000);
        guests.mint();
        expect(ended).toEqual([leaving.guest.id, idle.guest.id]);
        expect(guests.count()).toBe(1);
        expect(guests.byId(idle.guest.id)).toBeNull();
    });
});
