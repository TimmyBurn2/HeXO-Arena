// The API version is spec semver, decoupled from package versions on
// purpose.
export const apiVersion = `0.51.0`;

// The bot surface's own document, which other servers may implement,
// versions apart from the whole site's.
export const botApiVersion = `0.12.1`;

export const healthzPath = `/healthz`;

export * from './account';
export * from './admin';
export * from './analysis';
export * from './api';
export * from './axial';
export * from './board';
export * from './challenge';
export * from './dev';
export * from './estimate';
export * from './game-events';
export * from './games';
export * from './history';
export * from './htttx';
export * from './judgments';
export * from './leaderboard';
export * from './legal';
export * from './levels';
export * from './limits';
export * from './meta';
export * from './names';
export * from './notation';
export * from './pages';
export * from './players';
export * from './rating';
export * from './reports';
export * from './retention';
export * from './sigil';
export * from './sign-in';
export * from './stream';
export * from './tournaments';
