import { createElement, Fragment, type ReactNode } from 'react';

/**
 * Markup a catalog sentence asks for around some of its own words, such as
 * a link or a key: the sentence owns the words, the caller the element.
 */
export type Slot = (words: string) => ReactNode;

/**
 * Running text with elements inside it, as one fragment, so a sentence
 * and the links or values in it stay one catalog entry a locale can reorder.
 */
export function rich(strings: TemplateStringsArray, ...parts: ReactNode[]): ReactNode {
    const children: ReactNode[] = [];
    for (const [index, words] of strings.entries()) {
        if (words !== ``) children.push(words);
        if (index < parts.length) children.push(parts[index]);
    }
    return createElement(Fragment, null, ...children);
}
