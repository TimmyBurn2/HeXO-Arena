import { useState } from 'react';
import { readStored, writeStored } from '../stored';

/** Where this browser keeps whether the game lists show tests. */
export const showTestsKey = `hexo-arena.tests.v1`;

/** Whether the game lists show tests, off until the reader turns it on here. */
export function readShowTests(): boolean {
    return readStored(showTestsKey) === `on`;
}

/** The Show tests switch as this browser left it, kept as it changes. */
export function useShowTests(): [boolean, (on: boolean) => void] {
    const [on, setOn] = useState(readShowTests);
    return [
        on,
        (next) => {
            writeStored(showTestsKey, next ? `on` : `off`);
            setOn(next);
        },
    ];
}
