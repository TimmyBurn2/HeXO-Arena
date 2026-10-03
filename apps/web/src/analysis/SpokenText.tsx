import type { ValueText } from '@hexo-arena/contract';

/**
 * Words that may hold a value, in `className`, written by `write` where they show:
 * one span where a screen reader says them as shown, else shown to the eye and spoken apart, as a win chance is spoken in full.
 */
export function SpokenText({ words, className, write = (shown) => shown }: { words: ValueText; className: string; write?: (shown: string) => string }) {
    if (words.spoken === words.shown) return <span className={className}>{write(words.shown)}</span>;
    return (
        <>
            <span className={className} aria-hidden="true">
                {write(words.shown)}
            </span>
            <span className="sr-only">{words.spoken}</span>
        </>
    );
}
