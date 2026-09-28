import type { Ref } from 'react';
import { discordLoginPath, legalPagePath } from '@hexo-arena/contract';
import { Link } from '../router/Link';
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

/** The one way in: a link to the Discord OAuth login. */
export function DiscordButton({ ref }: { ref?: Ref<HTMLAnchorElement> }) {
    return (
        <a ref={ref} className="discord-button" href={discordLoginPath}>
            <DiscordFace />
        </a>
    );
}

/**
 * The top bar's way in, which has no room for the notice: the Discord look
 * on a button that opens a panel holding the Discord link with its notice.
 */
export function DiscordPanelButton({ ref, open, onClick }: { ref: Ref<HTMLButtonElement>; open: boolean; onClick: () => void }) {
    return (
        <button
            ref={ref}
            type="button"
            className="discord-button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? `identity-panel` : undefined}
            onClick={onClick}
        >
            <DiscordFace />
        </button>
    );
}

/**
 * The Discord button with its notice: signing in accepts the terms, and
 * what the site keeps from Discord, the public name made from the username
 * among it, with the terms and the privacy policy a click away.
 * `onNavigate` runs before a notice link navigates, so a panel holding
 * the notice can close first.
 */
export function DiscordSignIn({ onNavigate }: { onNavigate?: () => void }) {
    const page = (to: string) => (words: string) => (
        <Link to={to} {...(onNavigate === undefined ? {} : { onNavigate })}>
            {words}
        </Link>
    );
    return (
        <div className="discord-sign-in">
            <DiscordButton />
            <p className="note">{text.shell.signInNotice(page(legalPagePath(`terms`)), page(legalPagePath(`privacy`)))}</p>
        </div>
    );
}
