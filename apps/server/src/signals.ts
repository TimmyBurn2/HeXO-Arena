import type { EventEmitter } from 'node:events';

/** The two ways the process can end on a stop signal. */
export interface StopPaths {
    drain: () => void;
    stop: () => void;
}

/**
 * Routes the stop signals: SIGTERM is the deploy path and drains, SIGINT is
 * a developer's Ctrl-C and stops at once, cutting a drain short.
 * `fastStop` sends SIGTERM down the immediate path too.
 */
export function handleStopSignals(target: Pick<EventEmitter, `once`>, fastStop: boolean, paths: StopPaths): void {
    target.once(`SIGTERM`, fastStop ? paths.stop : paths.drain);
    target.once(`SIGINT`, paths.stop);
}
