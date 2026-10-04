import { crc32 } from '../src/zip';

/** A file as a zip's central directory and local header both describe it. */
export interface ReadEntry {
    readonly name: string;
    readonly data: Buffer;
    readonly text: string;
    readonly method: number;
    readonly crc: number;
    readonly dosTime: number;
    readonly dosDate: number;
}

/**
 * Reads a zip the way an unzip tool does, from the end record through the
 * central directory to each local header, failing on any field that
 * disagrees between the two or with the bytes stored.
 */
export function readZip(zip: Buffer): ReadEntry[] {
    const end = zip.length - 22;
    if (zip.readUInt32LE(end) !== 0x06054b50) throw new Error(`no end record where a zip without a comment has it`);
    const count = zip.readUInt16LE(end + 10);
    if (zip.readUInt16LE(end + 8) !== count) throw new Error(`the entry counts disagree`);
    const size = zip.readUInt32LE(end + 12);
    let at = zip.readUInt32LE(end + 16);
    if (at + size !== end) throw new Error(`the central directory does not end where the end record starts`);
    const entries: ReadEntry[] = [];
    for (let index = 0; index < count; index += 1) {
        if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error(`no central header at ${String(at)}`);
        const method = zip.readUInt16LE(at + 10);
        const crc = zip.readUInt32LE(at + 16);
        const stored = zip.readUInt32LE(at + 20);
        const nameLength = zip.readUInt16LE(at + 28);
        const extra = zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
        const local = zip.readUInt32LE(at + 42);
        const name = zip.subarray(at + 46, at + 46 + nameLength).toString(`ascii`);
        if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`no local header for ${name}`);
        if (zip.readUInt32LE(local + 14) !== crc || zip.readUInt32LE(local + 18) !== stored || zip.readUInt32LE(local + 22) !== zip.readUInt32LE(at + 24)) {
            throw new Error(`the local header of ${name} disagrees with its central one`);
        }
        if (zip.subarray(local + 30, local + 30 + nameLength).toString(`ascii`) !== name) throw new Error(`the local name of ${name} differs`);
        const start = local + 30 + nameLength + zip.readUInt16LE(local + 28);
        const data = zip.subarray(start, start + stored);
        if (crc32(data) !== crc) throw new Error(`the CRC of ${name} does not match its bytes`);
        entries.push({ name, data, text: data.toString(`utf8`), method, crc, dosTime: zip.readUInt16LE(at + 12), dosDate: zip.readUInt16LE(at + 14) });
        at += 46 + nameLength + extra;
    }
    return entries;
}
