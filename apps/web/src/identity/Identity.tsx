import { useEffect, useRef, useState } from 'react';
import type { GuestMe, UserMe } from '@hexo-arena/contract';
import { DiscordButton, DiscordSignIn } from '../components/DiscordButton';
import { Rating } from '../components/player';
import { TopbarPanel, usePanel, type PanelControl } from '../components/TopbarPanel';
import { meStore, useMe } from '../me';
import { Link } from '../router/Link';
import type { Route } from '../router/route';
import { text } from '../text';
import './Identity.css';

// The first control past the head takes focus on open, not the close button.
const firstItem = `.identity-items a, .identity-items button`;

/**
 * Who is here, at the top bar's right edge: signed out, the way in;
 * signed in or as a guest, a button that opens where to go and how to
 * leave, as a popover or, on phones, a sheet.
 */
export function Identity({ route }: { route: Route }) {
    const state = useMe();
    const control = usePanel(`identity`);
    const signIn = useRef<HTMLAnchorElement>(null);
    const leftHere = useRef(false);

    // A session that ends takes the panel with it; ended from the panel,
    // focus goes on to the sign-in link that takes the button's place.
    const signedOut = state.status === `ready` && state.me === null;
    const close = control.close;
    useEffect(() => {
        if (!signedOut) return;
        close(false);
        if (leftHere.current) {
            leftHere.current = false;
            signIn.current?.focus();
        }
    }, [signedOut, close]);

    function markLeaving(leaving: boolean) {
        leftHere.current = leaving;
    }

    if (state.status === `loading`) {
        return <span className="identity" aria-hidden="true" />;
    }
    const me = state.me;
    if (me === null) {
        return <DiscordButton ref={signIn} />;
    }

    const open = control.mode !== `closed`;
    return (
        <>
            <button
                ref={control.button}
                type="button"
                className={`identity${route.name === `profile` ? ` active` : ``}`}
                // the tag reads as its own word to the eye; the name says it
                // in one phrase
                aria-label={me.kind === `guest` ? text.shell.identity.guestName(me.name) : undefined}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? `identity-panel` : undefined}
                onClick={control.toggle}
            >
                <span className="monogram" aria-hidden="true">
                    {me.kind === `user` ? me.name.slice(0, 1) : text.shell.identity.guestMonogram}
                </span>
                <span className="identity-label">{me.name}</span>
                {me.kind === `guest` ? <span className="tag muted">{text.shell.identity.unrated}</span> : null}
            </button>
            <TopbarPanel
                id="identity-panel"
                className="identity-panel"
                control={control}
                labelledBy="identity-name"
                head={<Head me={me} />}
                closeLabel={text.shell.identity.close}
                initialFocus={firstItem}
            >
                {me.kind === `user` ? (
                    <UserItems route={route} control={control} onLeave={markLeaving} />
                ) : (
                    <GuestItems onLeave={markLeaving} />
                )}
            </TopbarPanel>
        </>
    );
}

function Head({ me }: { me: UserMe | GuestMe }) {
    return (
        <p className="identity-head">
            <span id="identity-name" className="identity-head-name">
                {me.name}
            </span>
            {me.kind === `user` ? (
                <span className="identity-head-rating">
                    {text.shell.identity.rating(
                        (words) => (
                            <span className="sr-only">{words}</span>
                        ),
                        <Rating value={me.rating} provisional={me.provisional} />,
                    )}
                </span>
            ) : (
                <span className="tag muted">{text.shell.identity.unrated}</span>
            )}
        </p>
    );
}

function UserItems({ route, control, onLeave }: { route: Route; control: PanelControl; onLeave: (leaving: boolean) => void }) {
    function away() {
        control.close(false);
    }
    return (
        <>
            <div className="identity-items">
                <Link to="/profile" className="identity-row" ariaCurrent={route.name === `profile`} onNavigate={away}>
                    {text.shell.identity.profile}
                </Link>
                <Link to="/connect" className="identity-row" ariaCurrent={route.name === `connect`} onNavigate={away}>
                    {text.shell.identity.build}
                </Link>
            </div>
            <Leave label={text.shell.identity.signOut} failure={text.shell.identity.signOutFailed} onLeave={onLeave} />
        </>
    );
}

function GuestItems({ onLeave }: { onLeave: (leaving: boolean) => void }) {
    return (
        <>
            <div className="identity-items identity-join">
                <DiscordSignIn />
            </div>
            <Leave
                label={text.shell.identity.endGuest}
                note={text.shell.identity.endGuestNote}
                failure={text.shell.identity.endGuestFailed}
                onLeave={onLeave}
            />
        </>
    );
}

// Ending the session, account or guest, is one request; the panel goes
// when the session does.
function Leave({ label, note, failure, onLeave }: { label: string; note?: string; failure: string; onLeave: (leaving: boolean) => void }) {
    const [leaving, setLeaving] = useState(false);
    const [failed, setFailed] = useState(false);

    async function leave() {
        setLeaving(true);
        setFailed(false);
        onLeave(true);
        try {
            await meStore.signOut();
        } catch {
            onLeave(false);
            setFailed(true);
            setLeaving(false);
        }
    }

    return (
        <div className="identity-leave">
            <button
                type="button"
                className="identity-row"
                disabled={leaving}
                aria-describedby={note === undefined ? undefined : `identity-leave-note`}
                onClick={() => void leave()}
            >
                {label}
            </button>
            {note === undefined ? null : (
                <p className="note identity-note" id="identity-leave-note">
                    {note}
                </p>
            )}
            {failed ? (
                <p className="field-error" role="alert">
                    {failure}
                </p>
            ) : null}
        </div>
    );
}
