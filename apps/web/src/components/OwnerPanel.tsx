import { useState } from 'react';
import { ApiError, deleteBot, limitedFor, rotateBotToken } from '../api/client';
import { navigate } from '../router/use-route';
import { text } from '../text';
import { TokenBox } from './TokenBox';
import { useWait, WaitText, type Wait } from './wait';
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
                {text.bot.owner.title}
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
    const limited = useWait();

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
        } catch (cause) {
            const wait = limitedFor(cause);
            if (wait === null) setFailure(text.bot.owner.rotateFailed);
            else limited.start(wait);
        }
        setSending(false);
    }

    return (
        <div className="owner-row">
            <div className="owner-text">
                <h3>{text.bot.owner.token}</h3>
                <p className="note">{text.bot.owner.tokenNote}</p>
            </div>
            {token === null ? (
                <button type="button" className="btn btn-ghost" disabled={sending || limited.wait !== null} onClick={() => void rotate()}>
                    {armed ? text.bot.owner.rotateArmed : text.bot.owner.rotate}
                </button>
            ) : (
                <div className="owner-token">
                    <TokenBox token={token} />
                </div>
            )}
            <Failure failure={failure} wait={limited.wait} />
        </div>
    );
}

function DeleteBot({ bot }: { bot: string }) {
    const [typed, setTyped] = useState(``);
    const [failure, setFailure] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const limited = useWait();
    const confirmed = typed === bot;

    async function remove() {
        setSending(true);
        setFailure(null);
        try {
            await deleteBot(bot);
            navigate(`/profile`);
        } catch (cause) {
            const wait = limitedFor(cause);
            if (wait !== null) {
                limited.start(wait);
            } else {
                setFailure(
                    cause instanceof ApiError && cause.code === `in_game`
                        ? text.bot.owner.inGame(bot)
                        : text.bot.owner.deleteFailed(bot),
                );
            }
            setSending(false);
        }
    }

    return (
        <div className="owner-row">
            <div className="owner-text">
                <h3>{text.bot.owner.delete}</h3>
                <p className="note">{text.bot.owner.deleteNote}</p>
            </div>
            <form
                className="name-field"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (confirmed) void remove();
                }}
            >
                <label className="field-label" htmlFor="delete-confirm">
                    {text.bot.owner.confirmName(bot)}
                </label>
                <input
                    id="delete-confirm"
                    type="text"
                    value={typed}
                    autoComplete="off"
                    onChange={(event) => {
                        setTyped(event.target.value);
                    }}
                />
                <button type="submit" className="btn btn-danger" disabled={!confirmed || sending || limited.wait !== null}>
                    {text.bot.owner.deleteBot(bot)}
                </button>
            </form>
            <Failure failure={failure} wait={limited.wait} />
        </div>
    );
}

function Failure({ failure, wait }: { failure: string | null; wait: Wait | null }) {
    if (wait !== null) {
        return (
            <p className="field-error" role="alert">
                <WaitText wait={wait} line={text.states.tooMany} />
            </p>
        );
    }
    return failure === null ? null : (
        <p className="field-error" role="alert">
            {failure}
        </p>
    );
}
