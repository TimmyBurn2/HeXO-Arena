// The API version is spec semver, decoupled from package versions on
// purpose.
export const apiVersion = `0.49.1`;

// The bot surface's own document, which other servers may implement,
// versions apart from the whole site's.
export const botApiVersion = `0.12.0`;

export const healthzPath = `/healthz`;

export * from './account';
export * from './admin';
export * from './analysis';
export * from './api';
export * from './axial';
export * from './board';
export * from './challenge';
export * from './dev';
export * from './duel-estimate';
export * from './duels';
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
export * from './players';
export * from './rating';
export * from './reports';
export * from './retention';
export * from './sigil';
export * from './sign-in';
export * from './stream';
export * from './tournaments';
