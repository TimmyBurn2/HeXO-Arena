import { useState } from 'react';
import { ApiError, deleteBot, rotateBotToken } from '../api/client';
import { navigate } from '../router/use-route';
import { TokenBox } from './TokenBox';
import './OwnerPanel.css';

/**
 * What only the owner may do to a bot: mint a fresh token, killing the
 * old one, or delete the bot.
 * Both are one extra deliberate step away.
 */
export function OwnerPanel({ bot }: { bot: string }) {
    return (
        <section className="owner-panel card" aria-labelledby="owner-title">
            <h2 id="owner-title" className="owner-title">
                Yours to run
            </h2>
            <RotateToken bot={bot} />
            <DeleteBot bot={bot} />
        </section>
    );
}

function RotateToken({ bot }: { bot: string }) {
    const [armed, setArmed] = useState(false);
    const [token, setToken] = useState<string | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [sending, setSending] = useState(false);

    async function rotate() {
        if (!armed) {
            setArmed(true);
            return;
        }
        setSending(true);
        setFailure(null);
        try {
            setToken((await rotateBotToken(bot)).token);
            setArmed(false);
        } catch {
            setFailure(`The token did not rotate; the old one still works`);
        }
        setSending(false);
    }

    return (
        <div className="owner-row">
            <div className="owner-text">
                <h3>Token</h3>
                <p className="note">
                    A new token stops the old one at once; the running bot needs the new one to connect again.
                </p>
            </div>
            {token === null ? (
                <button type="button" className="btn btn-ghost" disabled={sending} onClick={() => void rotate()}>
                    {armed ? `Rotate now; the old token dies` : `Rotate token`}
                </button>
            ) : (
                <div className="owner-token">
                    <TokenBox token={token} />
                </div>
            )}
            {failure === null ? null : (
                <p className="field-error" role="alert">
                    {failure}
                </p>
            )}
        </div>
    );
}

function DeleteBot({ bot }: { bot: string }) {
    const [typed, setTyped] = useState(``);
    const [failure, setFailure] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const confirmed = typed === bot;

    async function remove() {
        setSending(true);
        setFailure(null);
        try {
            await deleteBot(bot);
            navigate(`/profile`);
        } catch (cause) {
            setFailure(
                cause instanceof ApiError && cause.code === `in_game`
                    ? `${bot} is in a game; finish or resign it first`
                    : `${bot} was not deleted; try again`,
            );
            setSending(false);
        }
    }

    return (
        <div className="owner-row">
            <div className="owner-text">
                <h3>Delete</h3>
                <p className="note">
                    Rated games stay in the record under a placeholder name; a bot with none frees its name.
                </p>
            </div>
            <form
                className="name-field"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (confirmed) void remove();
                }}
            >
                <input
                    type="text"
                    value={typed}
                    aria-label={`type ${bot} to confirm`}
                    placeholder={bot}
                    autoComplete="off"
                    onChange={(event) => {
                        setTyped(event.target.value);
                    }}
                />
                <button type="submit" className="btn btn-danger" disabled={!confirmed || sending}>
                    Delete {bot}
                </button>
            </form>
            {failure === null ? null : (
                <p className="field-error" role="alert">
                    {failure}
                </p>
            )}
        </div>
    );
}
