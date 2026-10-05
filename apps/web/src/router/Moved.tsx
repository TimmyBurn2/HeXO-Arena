import { useLayoutEffect } from 'react';
import { navigate } from './use-route';

/**
 * An old address taking the reader on to its new one in place, so Back
 * never returns to it; it shows nothing on the way.
 */
export function Moved({ to }: { to: string }) {
    useLayoutEffect(() => {
        navigate(to, { replace: true });
    }, [to]);
    return null;
}
