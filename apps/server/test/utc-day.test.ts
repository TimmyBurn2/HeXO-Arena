import { describe, expect, it } from 'vitest';
import { daySeconds, utcDay } from '../src/utc-day';

describe('utcDay', () => {
    it('starts a day at UTC midnight and counts the seconds to the next', () => {
        const midnight = Date.UTC(2026, 9, 5) / 1000;
        expect(utcDay(midnight)).toEqual({ start: midnight, secondsLeft: daySeconds });
        expect(utcDay(midnight + 3_600)).toEqual({ start: midnight, secondsLeft: daySeconds - 3_600 });
        expect(utcDay(midnight + daySeconds - 1)).toEqual({ start: midnight, secondsLeft: 1 });
        expect(utcDay(midnight + daySeconds)).toEqual({ start: midnight + daySeconds, secondsLeft: daySeconds });
    });
});
