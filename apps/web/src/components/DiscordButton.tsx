import type { Ref, SyntheticEvent } from 'react';
import { discordLoginHref, legalPagePath, nextPathOf } from '@hexo-arena/contract';
import { Link } from '../router/Link';
import { usePath } from '../router/use-route';
import { text } from '../text';
import { DiscordSymbol } from './DiscordSymbol';
import './DiscordButton.css';

// The symbol names the provider to the eye, so the label reads "Sign in";
// the hidden rest keeps the accessible name whole.
function DiscordFace() {
    return (
        <span className="discord-face">
            <DiscordSymbol />
            <span>{text.shell.signIn((words) => <span className="sr-only">{words}</span>)}</span>
        </span>
    );
}

/**
 * The one way in: a link to the Discord OAuth login, returning to `next`,
 * or to the page it is on when that is a page a sign-in returns to.
 * `guard` ignores the second click of a double click, for a link that can
 * appear where another control stood a moment before.
 */
export function DiscordButton({ ref, next, guard = false }: { ref?: Ref<HTMLAnchorElement>; next?: string; guard?: boolean }) {
    const path = usePath();
    // A page that rewrites its query in place has moved on since the render,
    // so the address is read again whenever the link could be followed:
    // focused, pressed, opened in a new tab, or copied.
    function reread(event: SyntheticEvent<HTMLAnchorElement>) {
        if (next === undefined) event.currentTarget.href = discordLoginHref(nextPathOf(window.location.pathname + window.location.search));
    }
    return (
        <a
            ref={ref}
            className="discord-button"
            href={discordLoginHref(next ?? nextPathOf(path + window.location.search))}
            onFocus={reread}
            onPointerDown={reread}
            onContextMenu={reread}
            onClick={(event) => {
                if (guard && event.detail > 1) {
                    event.preventDefault();
                    return;
                }
                reread(event);
            }}
        >
            <DiscordFace />
        </a>
    );
}

/**
 * The Discord button with its trust line: the email stays with Discord,
 * and a first sign-in asks for the public name, which is where the terms
 * are accepted; the privacy policy is a click away.
 * A guest's line says first that signing in ends the guest session.
 * `onNavigate` runs before the line's link navigates, so a panel holding
 * it can close first.
 */
export function DiscordSignIn({ onNavigate, next, guest = false }: { onNavigate?: () => void; next?: string; guest?: boolean }) {
    const privacy = (words: string) => (
        <Link to={legalPagePath(`privacy`)} {...(onNavigate === undefined ? {} : { onNavigate })}>
            {words}
        </Link>
    );
    return (
        <div className="discord-sign-in">
            <DiscordButton {...(next === undefined ? {} : { next })} />
            <p className="note">{guest ? text.shell.guestTrustLine(privacy) : text.shell.trustLine(privacy)}</p>
        </div>
    );
}
