import { useEffect, useRef, useState } from 'react';
import { nameKeyOf, type GuestMe, type UserMe } from '@hexo-arena/contract';
import { DiscordButton, DiscordSignIn } from '../components/DiscordButton';
import { Rating } from '../components/player';
import { Sigil } from '../components/Sigil';
import { TopbarPanel, usePanel, type PanelControl } from '../components/TopbarPanel';
import { meStore, useMe } from '../me';
import { Link } from '../router/Link';
import type { Route } from '../router/route';
import { text } from '../text';
import './Identity.css';

// The first control past the head takes focus on open, not the close button.
const firstItem = `.identity-items a, .identity-items button`;

/**
 * Who is here, at the top bar's right edge: signed out, the Discord link
 * itself, one click from anywhere and back; signed in or as a guest, a
 * button opening a popover or, on phones, a sheet with where to go and how
 * to leave.
 */
export function Identity({ route }: { route: Route }) {
    const state = useMe();
    const control = usePanel(`identity`);
    const leftHere = useRef(false);
    const signIn = useRef<HTMLAnchorElement>(null);

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
    const open = control.mode !== `closed`;
    // The first sign-in's page is itself the way in; a second sign-in there
    // would start over and lose where the first one returns to.
    if (me === null) return route.name === `welcome` ? null : <DiscordButton ref={signIn} />;

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
                <span className="monogram sigil-plate" aria-hidden="true">
                    <Sigil nameKey={me.kind === `user` ? nameKeyOf(me.name) : null} />
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
                // With only the way out in the panel,
                // focus waits on the close button rather than on ending the session.
                initialFocus={me.kind === `guest` && route.name === `welcome` ? `.topbar-panel-close` : firstItem}
            >
                {me.kind === `user` ? (
                    <UserItems me={me} route={route} control={control} onLeave={markLeaving} />
                ) : (
                    <GuestItems route={route} control={control} onLeave={markLeaving} />
                )}
            </TopbarPanel>
        </>
    );
}

// An account's pattern beside its name and rating; a guest's label with
// its unrated tag, which leave the narrow head no room for the rosette.
function Head({ me }: { me: UserMe | GuestMe }) {
    return (
        <p className="identity-head">
            {me.kind === `user` ? (
                <span className="identity-head-mark sigil-plate" aria-hidden="true">
                    <Sigil nameKey={nameKeyOf(me.name)} />
                </span>
            ) : null}
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

// The Discord account the session came from leads the panel's body, for
// the person alone.
function UserItems({ me, route, control, onLeave }: { me: UserMe; route: Route; control: PanelControl; onLeave: (leaving: boolean) => void }) {
    function away() {
        control.close(false);
    }
    return (
        <>
            {me.discord === null ? null : <p className="discord-line">{text.shell.identity.discord(me.discord)}</p>}
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

// On the first sign-in's page the guest is already signing in,
// and a second sign-in would start over, so the menu holds only the way out.
function GuestItems({ route, control, onLeave }: { route: Route; control: PanelControl; onLeave: (leaving: boolean) => void }) {
    return (
        <>
            {route.name === `welcome` ? null : (
                <div className="identity-items identity-join">
                    <DiscordSignIn
                        guest
                        onNavigate={() => {
                            control.close(false);
                        }}
                    />
                </div>
            )}
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
