// @vitest-environment jsdom
import { reportFormMetaName } from '@hexo-arena/contract';
import { afterEach, describe, expect, it } from 'vitest';
import { reportForm } from '../src/report-form';

afterEach(() => {
    document.head.querySelector(`meta[name="${reportFormMetaName}"]`)?.remove();
});

describe('the report form setting', () => {
    it('is on only where the shell says so in its tag, and read once at start', () => {
        reportForm.reset();
        expect(reportForm.on()).toBe(false);
        const tag = document.createElement(`meta`);
        tag.name = reportFormMetaName;
        tag.content = `on`;
        document.head.append(tag);
        expect(reportForm.on()).toBe(false);
        reportForm.reset();
        expect(reportForm.on()).toBe(true);
        tag.content = `off`;
        reportForm.reset();
        expect(reportForm.on()).toBe(false);
    });
});
