import { useCallback, useState } from 'react';
import { botAboutMaxLength, botRepoUrlMaxLength, type BotClient, type BotSettings } from '@hexo-arena/contract';
import { ApiError, deleteBot, fetchBotSettings, limitedFor, rotateBotToken, updateBotSettings } from '../api/client';
import { useAsync } from '../api/use-async';
import { navigate } from '../router/use-route';
import { text } from '../text';
import { TokenBox } from './TokenBox';
import { ActionFailure, useWait } from './wait';
import './OwnerPanel.css';

/**
 * What only the owner may do to a bot: set the text and link its pages
 * show, see the client it last connected with, mint a fresh token, killing
 * the old one, or delete the bot.
 * The token and the deletion are one extra deliberate step away.
 */
export function OwnerPanel({ bot, onChanged }: { bot: string; onChanged: () => void }) {
    const load = useCallback(async () => fetchBotSettings(bot), [bot]);
    const settings = useAsync(load);
    return (
        <section className="owner-panel card" aria-labelledby="owner-title">
            <h2 id="owner-title" className="owner-title">
                {text.bot.owner.title}
            </h2>
            {settings.data !== null ? (
                <>
                    <DuelsByOthers bot={bot} on={settings.data.duelsByOthers} />
                    <PageText bot={bot} settings={settings.data} onSaved={onChanged} />
                    <ClientRow client={settings.data.client} />
                </>
            ) : settings.error ? (
                <div className="owner-row">
                    <p className="field-error">{text.bot.owner.settingsFailed}</p>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={settings.reload}>
                        {text.states.tryAgain}
                    </button>
                </div>
            ) : null}
            <RotateToken bot={bot} />
            <DeleteBot bot={bot} />
        </section>
    );
}

// The fields hold the owner's own text, empty while the page shows what the bot declares.
function PageText({ bot, settings, onSaved }: { bot: string; settings: BotSettings; onSaved: () => void }) {
    const [saved, setSaved] = useState(settings);
    const [about, setAbout] = useState(settings.about ?? ``);
    const [repoUrl, setRepoUrl] = useState(settings.repoUrl ?? ``);
    const [sending, setSending] = useState(false);
    const [done, setDone] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const limited = useWait();
    const changed = about !== (saved.about ?? ``) || repoUrl !== (saved.repoUrl ?? ``);
    const words = text.bot.owner;

    async function save() {
        setSending(true);
        setFailure(null);
        setDone(false);
        try {
            const next = await updateBotSettings(bot, { about, repoUrl });
            setSaved(next);
            setAbout(next.about ?? ``);
            setRepoUrl(next.repoUrl ?? ``);
            setDone(true);
            onSaved();
        } catch (cause) {
            const wait = limitedFor(cause);
            if (wait !== null) limited.start(wait);
            else setFailure(cause instanceof ApiError && cause.code === `bad_request` ? words.pageRefused : words.pageFailed);
        }
        setSending(false);
    }

    return (
        <div className="owner-row">
            <div className="owner-text">
                <h3>{words.page}</h3>
                <p className="note">{words.pageNote}</p>
            </div>
            <form
                className="owner-form"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (changed && !sending) void save();
                }}
            >
                <label className="field-label" htmlFor="owner-about">
                    {words.about}
                </label>
                <textarea
                    id="owner-about"
                    value={about}
                    rows={3}
                    maxLength={botAboutMaxLength}
                    aria-describedby={saved.about === undefined && saved.declaredAbout !== undefined ? `owner-about-note` : undefined}
                    onChange={(event) => {
                        setAbout(event.target.value);
                        setDone(false);
                    }}
                />
                {saved.about === undefined && saved.declaredAbout !== undefined ? (
                    <p className="note" id="owner-about-note">
                        {words.declaredAbout}
                    </p>
                ) : null}
                <label className="field-label" htmlFor="owner-repo">
                    {words.repo}
                </label>
                <input
                    id="owner-repo"
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    value={repoUrl}
                    maxLength={botRepoUrlMaxLength}
                    aria-describedby={saved.repoUrl === undefined && saved.declaredRepoUrl !== undefined ? `owner-repo-note` : undefined}
                    onChange={(event) => {
                        setRepoUrl(event.target.value);
                        setDone(false);
                    }}
                />
                {saved.repoUrl === undefined && saved.declaredRepoUrl !== undefined ? (
                    <p className="note" id="owner-repo-note">
                        {words.declaredRepo}
                    </p>
                ) : null}
                <div className="owner-actions">
                    <button type="submit" className="btn btn-ghost" disabled={!changed || sending || limited.wait !== null}>
                        {words.save}
                    </button>
                    <p className="field-ok" role="status">
                        {done && !changed ? words.saved : null}
                    </p>
                </div>
                <ActionFailure failure={failure} wait={limited.wait} />
            </form>
        </div>
    );
}

// The switch saves as it flips; a refusal flips it back and says so.
function DuelsByOthers({ bot, on }: { bot: string; on: boolean }) {
    const [held, setHeld] = useState(on);
    const [sending, setSending] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const limited = useWait();
    const words = text.duels.owner;

    async function flip(next: boolean) {
        setHeld(next);
        setSending(true);
        setFailure(null);
        try {
            setHeld((await updateBotSettings(bot, { duelsByOthers: next })).duelsByOthers);
        } catch (cause) {
            setHeld(!next);
            const wait = limitedFor(cause);
            if (wait !== null) limited.start(wait);
            else setFailure(words.failed);
        }
        setSending(false);
    }

    return (
        <div className="owner-row">
            <div className="owner-text">
                <h3 id="duels-by-others">{words.title}</h3>
                <p className="note" id="duels-by-others-note">
                    {words.note(bot)}
                </p>
            </div>
            <input
                type="checkbox"
                role="switch"
                aria-labelledby="duels-by-others"
                aria-describedby="duels-by-others-note"
                checked={held}
                disabled={sending || limited.wait !== null}
                onChange={(event) => void flip(event.target.checked)}
            />
            <ActionFailure failure={failure} wait={limited.wait} />
        </div>
    );
}

function ClientRow({ client }: { client: BotClient | undefined }) {
    const words = text.bot.owner;
    return (
        <div className="owner-row">
            <div className="owner-text">
                <h3>{words.client}</h3>
                <p className="note">{client === undefined ? words.clientNone : client.kind === `hexo-bridge` ? words.clientBridge(client.version) : words.clientOther}</p>
            </div>
        </div>
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
            <ActionFailure failure={failure} wait={limited.wait} />
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
            <ActionFailure failure={failure} wait={limited.wait} />
        </div>
    );
}
