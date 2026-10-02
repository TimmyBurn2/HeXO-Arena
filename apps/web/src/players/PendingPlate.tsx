import type { ReactNode } from 'react';

/**
 * A player page's plate before its read lands, or when it fails: the name
 * stands as the heading where the loaded plate holds it, so nothing jumps
 * when the rating arrives.
 */
export function PendingPlate({ name, tag }: { name: string; tag: ReactNode }) {
    return (
        <div className="bot-lift">
            <header className="bot-plate">
                <div className="bot-title">
                    <h1>{name}</h1>
                    {tag}
                </div>
                <div className="bot-rating" aria-hidden="true">
                    <span className="bot-rating-pending" />
                </div>
            </header>
        </div>
    );
}
