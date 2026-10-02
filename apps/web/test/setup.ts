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

// The repository's deployment has every legal document; a test about one
// missing serves its own.
// It takes reports through the site's form too; a test about one that
// does not turns the form off.
beforeEach(() => {
    onlyLegal(...legalPages);
    reportForm.reset(true);
});
