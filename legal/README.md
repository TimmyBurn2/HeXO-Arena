# Legal documents

Each deployment publishes its own legal documents.
The files here are templates; one details file fills them in.

| file | what it is |
|---|---|
| `imprint.md` | Impressum / Legal notice: who runs the site and how to reach them |
| `privacy.md` | Privacy policy: what the site stores, why, for how long, and the visitor's rights |
| `terms.md` | Terms of use: the rules for accounts, bots, names, and games |
| `details.example.json` | the details the templates name, every value a placeholder |

## What to copy where

1. Copy this folder to the box as `legal/`, beside `compose.yml`.
2. In that copy, copy `details.example.json` to `details.json` and replace every `<...>` value.
3. Delete the documents the deployment does not need; see below.
   A sentence pointing at a deleted document keeps its words, unlinked, so reword it: the Terms name the Impressum under The service and the Privacy policy under Guests and Ending, and the Impressum names the Terms under Reporting content.
4. Open each remaining page, `https://<domain>/legal/imprint`, `/legal/privacy`, and `/legal/terms`, and read it through.

Caddy serves `imprint.md`, `privacy.md`, `terms.md`, and `details.json` from the copy, mounted read-only, and nothing else in it.
An edit shows on the next page load; nothing restarts.
The site links only the documents the folder has: a deleted one leaves no link, and its page is not found.
The app reads the folder too, read-only, and its boot log names the documents missing from it and a `details.json` that is missing or invalid.

`pnpm dev` serves the repository's templates with `details.example.json`.

## What to fill in

`details.json` holds every value the documents name; all of them are public.

- `operator`: your `name`, `street` and number, `postcodeAndCity`, `country`, an `email` a person reads, and optionally a `discord` handle.
- `host`: the hosting company's `name` and postal address, and `serverLocation`, the city and country of the server.
- `supervisoryAuthority`: the data protection authority's `name`, postal address, and `url`, an `https://` address.
- `mailProvider`, optional: the `name` and postal address of whoever hosts the contact mailbox.

Every postal address takes the same three keys: `street`, `postcodeAndCity`, and `country`.
A key the file does not know, or a required one it lacks, makes the file invalid: every document that names a detail, all three as they come, is then left out, and the browser console names the key at fault.
An optional value left out takes the paragraph or list item naming it with it.

## Placeholders

A placeholder is a dotted name in double braces.
`{{operator.name}}`, `{{host.serverLocation}}`, and every other name of a party and its field come from `details.json`.
`{{site.name}}` and the other `site.` names come from the site's code: the cookie names, how long a session lasts, the minimum age.
Leave those as they are; they stay true when the code changes.
A placeholder neither knows shows as written, so a misspelling is plain on the page.

## Which documents are required where

This is not legal advice.

- **Impressum** (`imprint.md`): required of an operator in Germany.
  sec. 18(1) Medienstaatsvertrag asks it of any public site that is not purely personal or family, money or not; sec. 5 DDG adds to it once the site is commercial.
  Elsewhere, keep it only if your law asks for something like it; otherwise delete it.
- **Privacy policy** (`privacy.md`): keep it.
  The GDPR covers an operator in the EU (Art. 3(1)), and one outside it who offers the site to people in the EU (Art. 3(2)).
  Being reachable from the EU does not count on its own (Recital 23), but a site that welcomes accounts from anywhere, the EU included, offers itself there.
- **Terms of use** (`terms.md`): no law requires them.
  They set the rules moderation acts on and limit the operator's liability; they are written for German law.

## Keep the texts true

The texts state what the code does and how the deployment runs it.
Check every sentence about your deployment against it:

- where the server stands, and "transfers no data outside the EU";
- the backups, kept for 14 days, which `BACKUP_KEEP` sets;
- the languages you answer in, in the Impressum;
- the law that applies, and the liability clause, in the Terms.

Change the "Last updated" line whenever a document changes.

## Markdown

Headings, paragraphs, lists, links, emphasis, quotes, code, and tables render.
Raw HTML and images are dropped, never shown or run.

- The first `#` heading is the page's title; the paragraph under it, such as the date, heads the page.
- Each `##` heading starts a section; from five sections the page lists them first.
- A section written as one quote (`>`) is set apart, as the right to object must be.
- A link to a section names its heading lowercased, punctuation dropped, spaces as hyphens: `[Reporting](/legal/terms#reporting)`.
- A line ending in a backslash breaks there, as the addresses do.
