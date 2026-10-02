// zod reads its settings from this global as it loads, and probes for
// Function as its first object schema is built; the site's CSP allows no
// eval, so without jitless the probe alone reports a violation on every page.
// A classic script runs before every module of the app, whatever chunk
// builds the schemas.
globalThis.__zod_globalConfig = { jitless: true };
