import { useCallback, useState } from 'react';
import { botCapPerUser, type GuestMe, type UserMe } from '@hexarena/contract';
import { fetchBots } from '../api/client';
import { useAsync } from '../api/use-async';
import { DiscordButton } from '../components/DiscordButton';
import { BotBadge, OpenTag, PresenceDot, Rating, provisionalNote } from '../components/player';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { meStore, useMe } from '../me';
import { Link } from '../router/Link';
import { navigate, useRoute } from '../router/use-route';
import { useDocumentMeta } from '../use-document-meta';
import './ProfileScreen.css';

export function ProfileScreen() {
    const route = useRoute();
    const state = useMe();
    useDocumentMeta(route);

    return (
        <>
            <h1 className="screen-title">Profile</h1>

            <h2 className="section-title">Identity</h2>
            {state.status === `loading` ? (
                <SkeletonRows />
            ) : state.me === null ? (
                <SignedOut />
            ) : state.me.kind === `guest` ? (
                <GuestIdentity me={state.me} />
            ) : (
                <UserIdentity me={state.me} />
            )}

            {state.status === `ready` && state.me?.kind === `user` ? <YourBots owner={state.me.name} /> : null}
        </>
    );
}

function SignedOut() {
    return (
        <div className="card">
            <p className="note">Discord is the only login; bots are created in Connect.</p>
            <p className="card-actions">
                <DiscordButton />
                <Link to="/connect" className="btn btn-ghost">
                    Connect
                </Link>
            </p>
        </div>
    );
}

function SignOutButton({ confirmWith }: { confirmWith?: string }) {
    const [armed, setArmed] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [failed, setFailed] = useState(false);

    async function leave() {
        if (confirmWith !== undefined && !armed) {
            setArmed(true);
            return;
        }
        setLeaving(true);
        setFailed(false);
        try {
            await meStore.signOut();
            navigate(`/`);
        } catch {
            setFailed(true);
            setLeaving(false);
        }
    }

    return (
        <>
            <button type="button" className="btn btn-ghost" disabled={leaving} onClick={() => void leave()}>
                {armed && confirmWith !== undefined ? confirmWith : `Sign out`}
            </button>
            {failed ? (
                <p className="field-error" role="alert">
                    Sign-out did not reach the server; you are still signed in
                </p>
            ) : null}
        </>
    );
}

function UserIdentity({ me }: { me: UserMe }) {
    return (
        <div className="identity-plate">
            <span className="identity-monogram" aria-hidden="true">
                {me.name.slice(0, 1)}
            </span>
            <div className="identity-main">
                <span className="identity-name">{me.name}</span>
                <span className="identity-rating">
                    <span className="identity-number">
                        <Rating value={me.rating} provisional={me.provisional} />
                    </span>
                    <span className="note">{me.provisional ? provisionalNote : `Rating`}</span>
                </span>
            </div>
            <SignOutButton />
        </div>
    );
}

function GuestIdentity({ me }: { me: GuestMe }) {
    return (
        <div className="identity-plate">
            <span className="identity-monogram" aria-hidden="true">
                g
            </span>
            <div className="identity-main">
                <span className="identity-name">{me.name}</span>
                <span className="note">Guest games are unrated and end with the session.</span>
            </div>
            <div className="card-actions">
                <DiscordButton />
                <SignOutButton confirmWith="Sign out and end guest games" />
            </div>
        </div>
    );
}

// The account's bots from the public directory; a bot the operator has
// delisted is absent there, so it is absent here too, and the note says so.
function YourBots({ owner }: { owner: string }) {
    const load = useCallback(async () => fetchBots(false), []);
    const { data, error, loading, reload } = useAsync(load);

    if (loading && data === null) return <SkeletonRows />;
    if (error && data === null) return <ErrorFrame sentence="Your bots did not load" onRetry={reload} />;
    const mine = (data ?? []).filter((bot) => bot.ownerName === owner);

    return (
        <>
            <div className="section-head">
                <h2 className="section-title">Your bots</h2>
                <span className="note">
                    {String(mine.length)} of {String(botCapPerUser)}
                </span>
            </div>
            <div className="bot-cards">
                {mine.map((bot) => (
                    <Link key={bot.name} to={`/bots/${encodeURIComponent(bot.name)}`} className="bot-card">
                        <span className="bot-card-name">
                            <PresenceDot online={bot.online} />
                            {bot.name}
                            <BotBadge />
                        </span>
                        <span className="bot-card-rating">
                            <Rating value={bot.rating} provisional={bot.provisional} />
                        </span>
                        <OpenTag open={bot.openForChallenges} />
                    </Link>
                ))}
                {mine.length < botCapPerUser ? (
                    <Link to="/connect" className="bot-card bot-card-new">
                        <span className="bot-card-name">Create a bot</span>
                        <span className="note">
                            {String(botCapPerUser - mine.length)} {botCapPerUser - mine.length === 1 ? `slot` : `slots`} free
                        </span>
                    </Link>
                ) : null}
            </div>
            <p className="note">Bots the operator has delisted do not show here, and still count toward the cap.</p>
        </>
    );
}
