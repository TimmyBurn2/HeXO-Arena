import { useEffect, useId, useRef, useState } from 'react';
import { isReservedName, nameKeyOf, namePattern, type Me, type Signup } from '@hexo-arena/contract';
import { ApiError, cancelSignup, createAccount, fetchSignup, limitedFor } from '../api/client';
import { useWait, WaitText } from '../components/wait';
import { DiscordSignIn } from '../components/DiscordButton';
import { DiscordSymbol } from '../components/DiscordSymbol';
import { Sigil } from '../components/Sigil';
import { SkeletonRows } from '../components/states';
import { useLegalSlots } from '../legal/links';
import { meStore, useMe } from '../me';
import { parseRoute } from '../router/route';
import { navigate, useRoute } from '../router/use-route';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import './WelcomeScreen.css';

// What the page holds: the sign-up to finish, one that is gone, or a read
// that did not come back.
type View =
    | { kind: `loading` }
    | { kind: `ready`; signup: Signup }
    | { kind: `ended`; sentence: string; next: string; announce: boolean }
    | { kind: `failed` };

// A refusal the server gives for one name, which the field shows until the
// name changes, or a failure of the request itself.
type Refusal = { kind: `taken`; name: string } | { kind: `failed` };

/**
 * A first sign-in's last step: the Discord account it came from, the
 * public name to choose, and the terms accepted where the account is made.
 * Nothing is kept until Create account, and Cancel drops everything.
 */
export function WelcomeScreen() {
    const route = useRoute();
    useDocumentMeta(route);
    const me = useMe();
    const [view, setView] = useState<View>({ kind: `loading` });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let cancelled = false;
        fetchSignup().then(
            (signup) => {
                if (!cancelled) setView({ kind: `ready`, signup });
            },
            (cause: unknown) => {
                if (cancelled) return;
                setView(
                    cause instanceof ApiError && cause.status === 410
                        ? { kind: `ended`, sentence: text.welcome.expired, next: `/`, announce: false }
                        : { kind: `failed` },
                );
            },
        );
        return () => {
            cancelled = true;
        };
    }, [attempt]);

    // The page waits to know who is here, since the card's lines and its
    // answer to a refusal depend on the session;
    // someone signed in with no sign-up waiting has nothing to finish,
    // so their profile takes its place.
    const unheld = view.kind === `ended` && !view.announce;
    const signedIn = unheld && me.status === `ready` && me.me?.kind === `user`;
    const waiting = view.kind === `loading` || me.status === `loading` || signedIn;
    useEffect(() => {
        if (signedIn) navigate(`/profile`, { replace: true });
    }, [signedIn]);

    // The title promises an account to create, so it waits until a sign-up
    // is known to wait or no one signed in is known to be here,
    // rather than showing and then going while the session loads.
    const titled = (view.kind !== `loading` && !unheld) || (me.status === `ready` && me.me?.kind !== `user`);

    return (
        <div className="welcome">
            {titled ? (
                <>
                    <h1 className="screen-title">{text.welcome.title}</h1>
                    <p className="note welcome-lead">{text.welcome.lead}</p>
                </>
            ) : null}
            {waiting ? (
                <SkeletonRows />
            ) : view.kind === `failed` ? (
                <div className="empty">
                    <h2>{text.welcome.failed}</h2>
                    <div className="actions">
                        <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                                setView({ kind: `loading` });
                                setAttempt((current) => current + 1);
                            }}
                        >
                            {text.states.tryAgain}
                        </button>
                    </div>
                </div>
            ) : view.kind === `ended` ? (
                <Ended sentence={view.sentence} next={view.next} announce={view.announce} guest={me.me?.kind === `guest`} />
            ) : (
                <SignupCard
                    signup={view.signup}
                    held={me.me}
                    onEnded={(sentence) => {
                        setView({ kind: `ended`, sentence, next: view.signup.next, announce: true });
                    }}
                />
            )}
        </div>
    );
}

// A sign-up that is gone starts over at Discord,
// back where it started when that is known.
// Ended by Create account, its sentence takes focus,
// so the change is read out where the card was.
function Ended({ sentence, next, announce, guest }: { sentence: string; next: string; announce: boolean; guest: boolean }) {
    const heading = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        if (announce) heading.current?.focus();
    }, [announce]);
    return (
        <div className="empty welcome-ended">
            <h2 ref={heading} tabIndex={-1}>
                {sentence}
            </h2>
            <DiscordSignIn next={next} guest={guest} />
        </div>
    );
}

// `held` is the session the browser holds, which Create account ends.
function SignupCard({ signup, held, onEnded }: { signup: Signup; held: Me; onEnded: (sentence: string) => void }) {
    const [name, setName] = useState(signup.suggestedName);
    const [refusal, setRefusal] = useState<Refusal | null>(null);
    const [sending, setSending] = useState(false);
    const limited = useWait();
    const field = useRef<HTMLInputElement>(null);
    const ids = useId();
    const legal = useLegalSlots();
    const statusId = `${ids}-status`;
    const noteId = `${ids}-note`;
    const ruleId = `${ids}-rule`;
    const { discord } = signup;

    const invalid = name !== `` && !namePattern.test(name);
    const reserved = !invalid && name !== `` && isReservedName(name);
    const taken = refusal?.kind === `taken` && refusal.name === name;
    const free = name === signup.suggestedName && !taken;
    const submittable = name !== `` && !invalid && !reserved && !taken && !sending && limited.wait === null;

    // The page leaves the history, so Back never returns to a spent sign-up;
    // Build a bot takes the new account to its bot's name.
    function goOn() {
        const back = parseRoute(new URL(signup.next, window.location.origin).pathname);
        navigate(signup.next, back.name === `connect` ? { landing: `bot-name`, replace: true } : { replace: true });
    }

    async function create() {
        setSending(true);
        setRefusal(null);
        try {
            await createAccount(name);
        } catch (cause) {
            if (cause instanceof ApiError && cause.code === `signup_expired`) {
                // Another tab may have made this account already,
                // which a session under a name other than the one held here shows.
                const now = await meStore.refresh();
                setSending(false);
                if (now?.kind === `user` && (held?.kind !== `user` || now.name !== held.name)) {
                    goOn();
                    return;
                }
                onEnded(text.welcome.expired);
                return;
            }
            setSending(false);
            const wait = limitedFor(cause);
            if (wait !== null) {
                limited.start(wait);
            } else if (cause instanceof ApiError && cause.code === `signup_limit`) {
                onEnded(text.welcome.limit);
            } else if (cause instanceof ApiError && cause.code === `name_taken`) {
                setRefusal({ kind: `taken`, name });
                // The way on is another name, so the field takes focus.
                field.current?.focus();
            } else {
                setRefusal({ kind: `failed` });
            }
            return;
        }
        await meStore.refresh();
        goOn();
    }

    async function cancel() {
        setSending(true);
        // The sign-up leaves the server either way:
        // a failed drop still expires on its own within minutes.
        await cancelSignup().catch(() => undefined);
        navigate(signup.next, { replace: true });
    }

    return (
        <div className="card welcome-card">
            <div className="from-discord">
                <span className="from-discord-plate" aria-hidden="true">
                    <DiscordSymbol />
                </span>
                <p className="from-discord-text">
                    <span className="from-discord-kicker">{text.welcome.kicker}</span>
                    <span className="from-discord-name">{discord.displayName ?? text.welcome.username(discord.username)}</span>
                    {discord.displayName === null ? null : <span className="from-discord-user">{text.welcome.username(discord.username)}</span>}
                </p>
            </div>
            <form
                className="public-name"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (submittable) void create();
                }}
            >
                <label className="field-label" htmlFor={`${ids}-name`}>
                    {text.welcome.nameLabel}
                </label>
                <div className="public-name-row">
                    {/* the pattern the name draws, redrawn as it is typed */}
                    <span className="public-name-mark sigil-plate" aria-hidden="true">
                        <Sigil nameKey={name === `` ? null : nameKeyOf(name)} />
                    </span>
                    <input
                        ref={field}
                        id={`${ids}-name`}
                        type="text"
                        value={name}
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={invalid || reserved || taken}
                        aria-describedby={`${statusId} ${noteId} ${ruleId}`}
                        onChange={(event) => {
                            setName(event.target.value);
                            if (refusal?.kind === `failed`) setRefusal(null);
                        }}
                    />
                </div>
                <div id={statusId} role="status">
                    {reserved ? (
                        <p className="field-error">{text.build.reserved}</p>
                    ) : taken ? (
                        <p className="field-error">{text.build.taken}</p>
                    ) : limited.wait !== null ? (
                        <p className="field-error">
                            <WaitText wait={limited.wait} line={text.states.tooMany} />
                        </p>
                    ) : refusal?.kind === `failed` ? (
                        <p className="field-error">{text.welcome.createFailed}</p>
                    ) : free && !invalid ? (
                        <p className="field-ok">{text.welcome.free(name)}</p>
                    ) : null}
                </div>
                <p className="note" id={noteId}>
                    {text.welcome.nameNote}
                </p>
                <p className={invalid ? `field-error` : `note`} id={ruleId}>
                    {text.build.nameRule}
                </p>
                {held === null ? null : (
                    <p className="note welcome-held">{held.kind === `guest` ? text.welcome.guestNote : text.welcome.userNote(held.name)}</p>
                )}
                <p className="note welcome-notice">{text.welcome.notice(legal)}</p>
                <p className="card-actions welcome-actions">
                    {/* Kept focusable while it cannot act, so a refused press
                        leaves focus where the person is. */}
                    <button type="submit" className="btn btn-primary" aria-disabled={!submittable}>
                        {text.welcome.create}
                    </button>
                    <button type="button" className="btn btn-ghost" aria-disabled={sending} onClick={() => void (sending ? undefined : cancel())}>
                        {text.welcome.cancel}
                    </button>
                </p>
            </form>
            <p className="note welcome-foot">{text.welcome.foot}</p>
        </div>
    );
}
