import { useRef, useState } from 'react';
import { text } from '../text';
import './CodeBlock.css';

type Outcome = `copied` | `selected`;

/**
 * A code sample in monospace under a head with its title and a copy
 * button; where the clipboard is out of reach, the button selects the
 * sample for the reader to copy.
 */
export function CodeBlock({ title, name, copyLabel, code }: { title: string; name: string; copyLabel: string; code: string }) {
    const shown = useRef<HTMLElement>(null);
    const [outcome, setOutcome] = useState<Outcome | null>(null);

    // Browsers lend the clipboard only during the click itself, so the
    // write starts before anything else is awaited.
    // A page served without TLS has no clipboard at all, and a reader may
    // refuse it; either way the write throws.
    async function copy() {
        try {
            await navigator.clipboard.writeText(code);
            setOutcome(`copied`);
        } catch {
            if (shown.current !== null) window.getSelection()?.selectAllChildren(shown.current);
            setOutcome(`selected`);
        }
    }

    return (
        <figure className="code-block" aria-label={name}>
            <div className="code-head">
                <span className="code-title">{title}</span>
                <span className="code-status" role="status">
                    {outcome === `copied` ? text.code.copied : outcome === `selected` ? text.code.selected : null}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" aria-label={copyLabel} onClick={() => void copy()}>
                    {text.code.copy}
                </button>
            </div>
            {/* A sample wider than the window scrolls inside its block, so the keyboard reaches it too. */}
            <pre tabIndex={0}>
                <code ref={shown}>{code}</code>
            </pre>
        </figure>
    );
}
