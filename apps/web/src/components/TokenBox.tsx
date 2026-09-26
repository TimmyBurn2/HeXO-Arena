import { useState } from 'react';
import './TokenBox.css';

/**
 * A token shown the one time it exists in the clear, with copy and the
 * warning that it will not show again.
 */
export function TokenBox({ token }: { token: string }) {
    const [copied, setCopied] = useState(false);

    async function copy() {
        try {
            await navigator.clipboard.writeText(token);
            setCopied(true);
        } catch {
            setCopied(false);
        }
    }

    return (
        <>
            <div className="token-box">
                <span className="token-value">{token}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()}>
                    {copied ? `Copied` : `Copy`}
                </button>
            </div>
            <p className="warn">
                The token shows once; if it is lost, rotate it from the bot page.
            </p>
        </>
    );
}
