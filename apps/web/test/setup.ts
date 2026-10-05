import { legalPages } from '@hexo-arena/contract';
import { beforeEach } from 'vitest';
import { reportForm } from '../src/report-form';
import { onlyLegal } from './legal-deploy';

// jsdom ships the dialog element without its show methods, and its
// elements without scrollIntoView; rendering needs none of the behavior,
// only the method surfaces.
if (typeof HTMLDialogElement !== `undefined`) {
    // the dom lib types promise these methods, so the record view is the
    // honest shape of jsdom's partial implementation
    const proto = HTMLDialogElement.prototype as unknown as Record<string, (() => void) | undefined>;
    proto.show ??= function (this: HTMLDialogElement) {
        this.setAttribute(`open`, ``);
    };
    proto.showModal ??= function (this: HTMLDialogElement) {
        this.setAttribute(`open`, ``);
    };
    proto.close ??= function (this: HTMLDialogElement) {
        this.removeAttribute(`open`);
        this.dispatchEvent(new Event(`close`));
    };
}

if (typeof Element !== `undefined`) {
    const elementProto = Element.prototype as unknown as Record<string, (() => void) | undefined>;
    elementProto.scrollIntoView ??= function scrollIntoView() {};
}

// Tests load no CSS, so jsdom reads every span as inline where the styled
// page lays it out as a block or a flex item.
// dom-accessibility-api trims each child's text and spaces apart only the
// children that are not inline, so accessible names would run together
// (`Sign inwith Discord`).
// An inline element reports no display here, which spaces every child the
// way the styled page reads; the browser suite checks a browser's names.
if (typeof window !== `undefined`) {
    const computedStyle = window.getComputedStyle.bind(window);
    window.getComputedStyle = (element, pseudo) => {
        const style = computedStyle(element, pseudo);
        if (style.display !== `inline`) return style;
        const propertyValue = style.getPropertyValue.bind(style);
        Object.defineProperty(style, `display`, { value: `` });
        style.getPropertyValue = (name) => (name === `display` ? `` : propertyValue(name));
        return style;
    };
}

// The repository's deployment has every legal document; a test about one
// missing serves its own.
// It takes reports through the site's form too; a test about one that
// does not turns the form off.
// The document outlives a test file's tests, so a title or an embed tag one
// test set would otherwise answer the next test's question about its own.
beforeEach(() => {
    onlyLegal(...legalPages);
    reportForm.reset(true);
    if (typeof document !== `undefined`) {
        document.title = ``;
        for (const tag of document.head.querySelectorAll(`meta[property^="og:"], meta[name="description"]`)) tag.remove();
    }
});
