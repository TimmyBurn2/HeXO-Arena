/** Turns of a game an analyzer reads and judges; later turns are neither. */
export const analysisTurnCap = 200;

/** Stones a position may hold to be read by an analyzer, or set up for one. */
export const analysisStoneCap = 401;

/** Turns the analysis board keeps in its move tree, every variation counted. */
export const analysisTreeNodeCap = 2_000;

/** The analysis board's page; a stored game opens on it as `?game=<id>&turn=<t>`. */
export const analysisPagePath = `/analysis`;
