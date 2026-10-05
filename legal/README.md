# Legal templates

Optional templates for a deployment's legal pages, written for an operator
in the EU under the GDPR.
They are not legal advice: adapt each document to your law, or delete it.
The site links only the documents the deployment's folder has.

| file | what it is |
|---|---|
| `privacy.md` | Privacy policy: what the site stores, why, for how long, and the visitor's rights. Keep it: it is the record of what the site stores, and it changes with the code. |
| `terms.md` | Terms of use: the rules moderation acts on. Optional; its law and liability clauses follow German law. |
| `imprint.md` | Impressum: who runs the site, which German law requires of an operator in Germany. Elsewhere, delete it unless your law asks for something like it. |
| `details.example.json` | The values the documents name, each a placeholder. |

## Set up

1. Copy this folder into the deployment folder as `legal/`, and there copy
   `details.example.json` to `details.json`.
2. Fill in `details.json`; every value is public.
   Replace every `<...>`: a placeholder left in goes public as written.
   Optional: the operator's postal address and `discord` (the Impressum
   needs the address), `host.serverLocation`, `supervisoryAuthority`, and
   `mailProvider`; a value left out takes its line or paragraph with it.
   A postal address is `street`, `postcodeAndCity`, and `country`, all three.
   An invalid file leaves out every document naming a detail; the browser
   console and the app's boot log name the key.
3. Delete what you do not need, and reword a sentence that names it: the
   Terms name the Privacy policy, and the Impressum names the Terms.
4. Check each sentence about your deployment: where the server stands and
   "transfers no data outside the EU"; the processing agreement with your
   host (Art. 28 GDPR); backups kept 14 days (`BACKUP_KEEP`); "a free,
   non-commercial hobby project"; the law and liability clauses; the
   languages you answer in.
   Change "Last updated" with each edit.
5. After the deploy, read each page through.

`{{site.*}}` values come from the code; leave them.
Text between `{{#site.reportForm}}` and `{{/site.reportForm}}`, each tag on
a line of its own, shows only where `REPORT_FORM` is `on`; between
`{{^site.reportForm}}` and the closing tag, only where it is off.
Raw HTML, such as the note opening each template, and images never show.
