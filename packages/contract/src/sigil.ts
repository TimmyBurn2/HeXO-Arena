/**
 * A name's seven cells, the center first, then the ring in order: right,
 * lower right, lower left, left, upper left, upper right.
 */
export type SigilCells = readonly [boolean, boolean, boolean, boolean, boolean, boolean, boolean];

// 32-bit FNV-1a over the fold's UTF-16 code units, finished with the
// murmur3 mix so neighboring names land far apart.
function hashOf(nameKey: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < nameKey.length; index += 1) {
        hash ^= nameKey.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b) >>> 0;
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
    hash ^= hash >>> 16;
    return hash >>> 0;
}

// The ring holds six cells; all dark or all lit would read as no pattern,
// which leaves 62.
const ringPatterns = 62;

/**
 * The hexagon pattern a name draws, from its fold alone, so a name draws
 * the same pattern wherever it shows and nothing is stored: the center
 * always lit, and the ring in one of 62 patterns of one to five lit cells.
 */
export function sigilCells(nameKey: string): SigilCells {
    const mask = (hashOf(nameKey) % ringPatterns) + 1;
    const ring = (index: number) => ((mask >> index) & 1) === 1;
    return [true, ring(0), ring(1), ring(2), ring(3), ring(4), ring(5)];
}
