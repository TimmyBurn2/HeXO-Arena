// The API version is spec semver, decoupled from package versions on
// purpose.
export const apiVersion = `0.32.0`;

// The bot surface's own document, which other servers may implement,
// versions apart from the whole site's.
export const botApiVersion = `0.8.0`;

export const healthzPath = `/healthz`;

export * from './admin';
export * from './api';
export * from './axial';
export * from './board';
export * from './challenge';
export * from './dev';
export * from './game-events';
export * from './games';
export * from './history';
export * from './htttx';
export * from './leaderboard';
export * from './legal';
export * from './limits';
export * from './meta';
export * from './names';
export * from './players';
export * from './sigil';
export * from './sign-in';
export * from './stream';
export * from './tournaments';
