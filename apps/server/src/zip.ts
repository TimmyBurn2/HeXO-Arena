/** A file a zip archive holds. */
export interface ZipEntry {
    /** Its path in the archive: printable ASCII, no leading slash. */
    readonly name: string;
    readonly data: string | Uint8Array;
    readonly modified: Date;
}

// The reflected CRC-32 polynomial zip names, one table entry per byte value.
const crcTable = Array.from({ length: 256 }, (_, byte) => {
    let value = byte;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});

/** The CRC-32 a zip archive stores for a file's bytes. */
export function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

// MS-DOS time counts two-second steps and years from 1980, in UTC here
// so an archive reads the same wherever it was written.
function dosTime(at: Date): { time: number; date: number } {
    const year = Math.min(Math.max(at.getUTCFullYear(), 1980), 2107);
    return {
        time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | Math.floor(at.getUTCSeconds() / 2),
        date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
    };
}

// A plain zip counts entries in 16 bits and bytes in 32; nothing written here comes near either.
const entryCap = 0xffff;
const byteCap = 0xffffffff;

/**
 * A zip archive storing each entry uncompressed: a local header and the
 * bytes per entry, then the central directory and its end record.
 * Fields left zero say: no flags, stored, no extra field, comment, or attributes.
 */
export function zipStore(entries: readonly ZipEntry[]): Buffer {
    if (entries.length > entryCap) throw new Error(`a zip holds at most ${String(entryCap)} entries`);
    const encoder = new TextEncoder();
    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const entry of entries) {
        if (!/^[ -~]+$/u.test(entry.name) || entry.name.startsWith(`/`)) throw new Error(`a zip entry name is printable ASCII and relative: ${entry.name}`);
        const name = Buffer.from(entry.name, `ascii`);
        const data = typeof entry.data === `string` ? encoder.encode(entry.data) : entry.data;
        const crc = crc32(data);
        const { time, date } = dosTime(entry.modified);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(10, 4);
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(10, 6);
        header.writeUInt16LE(time, 12);
        header.writeUInt16LE(date, 14);
        header.writeUInt32LE(crc, 16);
        header.writeUInt32LE(data.length, 20);
        header.writeUInt32LE(data.length, 24);
        header.writeUInt16LE(name.length, 28);
        header.writeUInt32LE(offset, 42);
        central.push(header, name);
        parts.push(local, name, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
        offset += local.length + name.length + data.length;
        if (offset > byteCap) throw new Error(`a zip holds at most ${String(byteCap)} bytes`);
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, directory, end]);
}
