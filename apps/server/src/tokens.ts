import { createHash, randomBytes } from 'node:crypto';

export function randomToken(bytes: number): string {
    return randomBytes(bytes).toString(`base64url`);
}

// Bot and session tokens are stored one-way: only their sha256 digests
// are ever persisted or compared.
export function sha256Hex(value: string): string {
    return createHash(`sha256`).update(value).digest(`hex`);
}
