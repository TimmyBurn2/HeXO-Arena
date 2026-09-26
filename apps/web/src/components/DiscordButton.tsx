import { discordLoginPath } from '@hexarena/contract';
import { DiscordSymbol } from './DiscordSymbol';
import './DiscordButton.css';

/**
 * The one way in: a link to the Discord OAuth login.
 * The symbol names the provider to the eye, so the label reads "Sign in";
 * the hidden rest keeps the accessible name whole.
 */
export function DiscordButton() {
    return (
        <a className="discord-button" href={discordLoginPath}>
            <span className="discord-face">
                <DiscordSymbol />
                <span>
                    Sign in<span className="sr-only"> with Discord</span>
                </span>
            </span>
        </a>
    );
}

/**
 * The Discord button with the line that says what signing in shares, for
 * the places a visitor decides whether to sign in.
 */
export function DiscordSignIn() {
    return (
        <div className="discord-sign-in">
            <DiscordButton />
            <p className="note">Discord shares your username only; no email.</p>
        </div>
    );
}
