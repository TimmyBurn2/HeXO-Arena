import type { MouseEvent, ReactNode } from 'react';
import { navigate } from './use-route';

/**
 * An anchor that navigates in the SPA; modified clicks and non-primary
 * buttons fall through to the browser.
 */
export function Link({ to, className, children, ariaCurrent, ariaLabel }: {
    to: string;
    className?: string;
    children: ReactNode;
    ariaCurrent?: boolean;
    ariaLabel?: string;
}) {
    function handleClick(event: MouseEvent<HTMLAnchorElement>) {
        if (event.defaultPrevented) return;
        if (event.button !== 0) return;
        if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigate(to);
    }

    return (
        <a
            href={to}
            className={className}
            aria-current={ariaCurrent ? `page` : undefined}
            aria-label={ariaLabel}
            onClick={handleClick}
        >
            {children}
        </a>
    );
}
