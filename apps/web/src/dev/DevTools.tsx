import { nextPathOf, welcomePath, type DevAccount } from '@hexo-arena/contract';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useFramed } from '../frame';
import { meStore, useMe, type MeState } from '../me';
import { navigate, useRoute } from '../router/use-route';
import { devEn } from '../text/dev-en';
import { devFirstSignIn, devSignIn, fetchDevAccounts } from './dev-api';
import { afterHolder, discordLinkOf } from './discord-click';
import '../components/player.css';
import '../components/TopbarPanel.css';
import './DevTools.css';

function whoOf(state: MeState): string {
    if (state.status === `loading`) return devEn.loading;
    return state.me === null ? devEn.signedOut : state.me.name;
}

function failureOf(cause: unknown, name: string): string {
    const code = cause instanceof ApiError ? cause.code : null;
    switch (code) {
        case `banned`:
            return devEn.failed.banned(name);
        case `invalid_name`:
        case `name_reserved`:
        case `name_taken`:
            return devEn.failed[code];
        default:
            return devEn.failed.other;
    }
}

/**
 * The dev pill at the foot of framed screens, naming who is signed in, and
 * its panel: the seeded personas one click away, any name, the first
 * sign-in, a guest session, and the way out.
 * In dev the Discord button opens the panel, since there is no Discord;
 * `opened` starts the panel open for a click made before the pill came.
 */
export function DevTools({ initial, opened }: { initial: readonly DevAccount[]; opened: boolean }) {
    const route = useRoute();
    const framed = useFramed(route);
    const me = useMe();
    const [open, setOpen] = useState(opened);
    const [accounts, setAccounts] = useState(initial);
    const [failure, setFailure] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [name, setName] = useState(``);
    const pill = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const fieldId = useId();
    const noteId = useId();

    // A capture listener on the document runs before the app's own, so the
    // Discord link neither navigates nor reaches its handlers.
    useEffect(() => {
        function intercept(event: MouseEvent) {
            const link = discordLinkOf(event);
            if (link === null) return;
            event.preventDefault();
            event.stopPropagation();
            afterHolder(link, () => {
                setOpen(true);
            });
        }
        document.addEventListener(`click`, intercept, true);
        return () => {
            document.removeEventListener(`click`, intercept, true);
        };
    }, []);

    // Ratings and bots move while the panel is shut, so each opening reads them again.
    useEffect(() => {
        if (!open) return;
        setFailure(null);
        void fetchDevAccounts().then((fresh) => {
            if (fresh !== null) setAccounts(fresh);
        });
        panel.current?.querySelector<HTMLElement>(`.dev-persona, .dev-sign-in input`)?.focus();
    }, [open]);

    useEffect(() => {
        if (!open) return;
        function shut(event: KeyboardEvent) {
            if (event.key !== `Escape`) return;
            setOpen(false);
            pill.current?.focus();
        }
        function away(event: PointerEvent) {
            const target = event.target;
            if (!(target instanceof Node) || panel.current?.contains(target) === true || pill.current?.contains(target) === true) return;
            setOpen(false);
        }
        document.addEventListener(`keydown`, shut);
        document.addEventListener(`pointerdown`, away);
        return () => {
            document.removeEventListener(`keydown`, shut);
            document.removeEventListener(`pointerdown`, away);
        };
    }, [open]);

    // A screen that leaves the frame, as the game does, takes the panel with it.
    useEffect(() => {
        if (!framed) setOpen(false);
    }, [framed]);

    // Controls stay focusable while a request runs, held by aria-disabled,
    // so focus never drops to the page.
    async function run(act: () => Promise<void>, who: string) {
        if (busy) return;
        setBusy(true);
        setFailure(null);
        try {
            await act();
            setOpen(false);
            pill.current?.focus();
        } catch (cause) {
            setFailure(failureOf(cause, who));
        } finally {
            setBusy(false);
        }
    }

    function signInAs(target: string) {
        void run(async () => {
            await devSignIn(target);
            await meStore.refresh();
        }, target);
    }

    const current = me.status === `ready` && me.me?.kind === `user` ? me.me.name : null;

    return (
        <>
            {framed ? (
                <div className="dev-pill-row">
                    <button
                        ref={pill}
                        type="button"
                        className="dev-pill"
                        aria-haspopup="dialog"
                        aria-expanded={open}
                        onClick={() => {
                            setOpen(!open);
                        }}
                    >
                        {devEn.pill(whoOf(me))}
                    </button>
                </div>
            ) : null}
            {open ? (
                <div ref={panel} className="dev-panel" role="dialog" aria-labelledby={titleId}>
                    <div className="dev-panel-head">
                        <h2 id={titleId} className="dev-panel-title">
                            {devEn.title}
                        </h2>
                        <button
                            type="button"
                            className="topbar-panel-close"
                            aria-label={devEn.close}
                            onClick={() => {
                                setOpen(false);
                                pill.current?.focus();
                            }}
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                        </button>
                    </div>
                    <h3 className="dev-panel-label">{devEn.personas}</h3>
                    {accounts.length === 0 ? (
                        <p className="dev-empty">{devEn.empty}</p>
                    ) : (
                        <ul className="dev-personas">
                            {accounts.map((account) => (
                                <li key={account.name}>
                                    <button
                                        type="button"
                                        className="dev-persona"
                                        aria-disabled={busy}
                                        aria-current={account.name === current ? `true` : undefined}
                                        onClick={() => {
                                            signInAs(account.name);
                                        }}
                                    >
                                        <span className="dev-persona-line">
                                            <span className="dev-persona-name">{account.name}</span>
                                            {account.name === current ? <span className="dev-you">{devEn.current}</span> : null}
                                            {account.banned ? <span className="tag muted">{devEn.banned}</span> : null}
                                            <span className="dev-persona-figures">
                                                {devEn.rating(account.rating, account.provisional)}, {devEn.bots(account.bots.length)}
                                            </span>
                                        </span>
                                        <span className="dev-persona-purpose">{account.purpose}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <form
                        className="dev-sign-in"
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (!busy && name.trim() !== ``) signInAs(name.trim());
                        }}
                    >
                        <label className="field-label" htmlFor={fieldId}>
                            {devEn.signInAs}
                        </label>
                        <div className="dev-sign-in-row">
                            <input
                                id={fieldId}
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                value={name}
                                onChange={(event) => {
                                    setName(event.target.value);
                                }}
                            />
                            <button type="submit" className="btn btn-ghost btn-sm" aria-disabled={busy}>
                                {devEn.signIn}
                            </button>
                        </div>
                    </form>
                    <div className="dev-first">
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-disabled={busy}
                            aria-describedby={noteId}
                            onClick={() => {
                                void run(async () => {
                                    await devFirstSignIn(nextPathOf(window.location.pathname + window.location.search));
                                    navigate(welcomePath);
                                }, ``);
                            }}
                        >
                            {devEn.firstSignIn}
                        </button>
                        <p className="dev-note" id={noteId}>
                            {devEn.firstSignInNote}
                        </p>
                    </div>
                    <div className="dev-actions">
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-disabled={busy}
                            onClick={() => {
                                void run(async () => {
                                    // A signed-in account keeps its session against a guest mint, so it goes first.
                                    if (me.status === `ready` && me.me?.kind === `user`) await meStore.signOut();
                                    await meStore.guest();
                                }, ``);
                            }}
                        >
                            {devEn.guest}
                        </button>
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-disabled={busy}
                            onClick={() => {
                                void run(() => meStore.signOut(), ``);
                            }}
                        >
                            {devEn.signOut}
                        </button>
                    </div>
                    {failure === null ? null : (
                        <p className="field-error" role="alert">
                            {failure}
                        </p>
                    )}
                </div>
            ) : null}
        </>
    );
}
