# Legal documents

Each deployment publishes its own legal documents: these templates, filled
in from one details file.

The texts are written for an operator in Germany under German and EU law.
Check every document against your own law and adapt it before publishing;
this folder is not legal advice.

| file | what it is |
|---|---|
| `imprint.md` | Impressum / Legal notice: who runs the site and how to reach them |
| `privacy.md` | Privacy policy: what the site stores, why, for how long, and the visitor's rights |
| `terms.md` | Terms of use: the rules for accounts, bots, names, and games |
| `details.example.json` | the details the templates name, every value a placeholder |

## What to copy

1. Copy this folder into the deployment folder as `legal/`.
2. In that copy, copy `details.example.json` to `details.json` and fill it
   in.
3. Delete the documents you do not need:
   - the Impressum is required of an operator in Germany (sec. 18(1)
     Medienstaatsvertrag, and sec. 5 DDG once the site is commercial) and
     needs a postal address; elsewhere keep it only if your law asks for
     something like it;
   - keep the privacy policy: the GDPR covers an operator in the EU, and one
     outside it who offers the site to people in the EU (Art. 3);
   - no law requires the terms, which set the rules moderation acts on and
     limit the operator's liability.

   A sentence pointing at a deleted document keeps its words, unlinked, so
   reword it: the Terms name the Privacy policy under Guests and Ending, and
   the Impressum names the Terms under Reporting content.
4. After the first deploy, open `https://<domain>/legal/imprint`,
   `/legal/privacy`, and `/legal/terms` and read each through.

## What to fill in

`details.json` holds every value the documents name, and all of it is
public.
Replace every `<...>` value: the example's placeholders pass the file's
check, so one left in goes public as written.

- `operator`: your `name`, an `email` a person reads, and optionally a
  postal address and a `discord` handle.
- `host`: the hosting company's `name` and postal address, and optionally
  `serverLocation`, the city and country of the server.
- `supervisoryAuthority`, optional: the data protection authority's `name`,
  postal address, and `url`, an `https://` address; without it the privacy
  policy states the right to complain and names no authority.
- `mailProvider`, optional: the `name` and postal address of whoever hosts
  the contact mailbox.

A postal address is three keys: `street`, `postcodeAndCity`, and `country`.
The operator gives all three or none; `host`, `supervisoryAuthority`, and
`mailProvider` need all three.
Without an operator address, delete `imprint.md`, which needs it, and
`discord`, which only the Impressum names; whether a name and email without
an address meet GDPR Art. 13(1)(a) is yours to judge.

An optional value left out takes the paragraph or list item naming it with
it; in a paragraph broken into lines, as an address is, only its line.
A key the file does not know, or a required one it lacks, makes it invalid:
every document naming a detail is then left out, and the browser console
and the app's boot log name the key at fault.

The passages about the report form stand between `{{#site.reportForm}}`
and `{{/site.reportForm}}`, each on a line of its own, and show only where
the server's `REPORT_FORM` is `on`; those between `{{^site.reportForm}}`
and `{{/site.reportForm}}` show only where it is off.

`{{site.name}}` and the other `site.` placeholders come from the site's
code, such as the cookie names and how long records are kept; leave them as
they are.
A placeholder nobody knows shows as written, so a misspelling is plain on
the page.

## Keep the texts true

The texts state what the code does and how the deployment runs it.
Check every sentence about your deployment, in particular:

- where the server stands, and "transfers no data outside the EU";
- the processing agreement (Art. 28 GDPR) the privacy policy says you have
  with your host: conclude one;
- the backups, kept on the server for 14 days, which `BACKUP_KEEP` sets;
- "a free, non-commercial hobby project", in the Terms;
- the languages you answer in, in the Impressum;
- the law that applies, and the liability clause, in the Terms.

Change the "Last updated" line whenever a document changes.
Headings, paragraphs, lists, links, emphasis, quotes, and tables render;
raw HTML, such as the note opening each template, and images never show.
