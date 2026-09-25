import { createHash, randomBytes } from 'node:crypto';

export function randomToken(bytes: number): string {
    return randomBytes(bytes).toString(`base64url`);
}

// SPEC.md section 9: sha256 at rest is the recorded choice for bot tokens;
// sessions use the same one-way storage.
export function sha256Hex(value: string): string {
    return createHash(`sha256`).update(value).digest(`hex`);
}
