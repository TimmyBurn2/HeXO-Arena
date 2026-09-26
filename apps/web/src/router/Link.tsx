import type { MouseEvent, ReactNode } from 'react';
import { navigate } from './use-route';

/**
 * An anchor that navigates in the SPA; modified clicks and non-primary
 * buttons fall through to the browser.
 * `onNavigate` runs just before an in-app navigation, so a popover can
 * close before the next screen takes focus.
 */
export function Link({ to, className, children, ariaCurrent, ariaLabel, onNavigate }: {
    to: string;
    className?: string;
    children: ReactNode;
    ariaCurrent?: boolean;
    ariaLabel?: string;
    onNavigate?: () => void;
}) {
    function handleClick(event: MouseEvent<HTMLAnchorElement>) {
        if (event.defaultPrevented) return;
        if (event.button !== 0) return;
        if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        onNavigate?.();
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
