import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Hosts name a repository's license by matching LICENSE against the
// license's template, and any sentence past it reads as another license.
const license = readFileSync(`LICENSE`, `utf8`);
const notice = readFileSync(`NOTICE`, `utf8`);

// NOTICE closes with the MIT text for the works it credits; LICENSE is the
// same text under the project's own copyright line.
const mitText = notice.slice(notice.indexOf(`Permission is hereby granted`));

describe(`LICENSE`, () => {
    it(`is the MIT License under the project's copyright and nothing more`, () => {
        assert.equal(license, `MIT License\n\nCopyright (c) 2026 TimmyBurn\n\n${mitText}`);
    });

    it(`leaves the font's own license to NOTICE`, () => {
        assert.match(notice, /Chakra Petch font in apps\/web\/public\/fonts is licensed under the\sSIL Open\sFont License 1\.1/u);
    });
});
