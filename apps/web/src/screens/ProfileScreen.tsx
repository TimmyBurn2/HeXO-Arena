import { useCallback, useId, useState } from 'react';
import { botCapPerUser, nameKeyOf, type BotListing, type GuestMe, type UserMe } from '@hexo-arena/contract';
import { fetchBots } from '../api/client';
import { useAsync } from '../api/use-async';
import { AccountPanel } from '../components/AccountPanel';
import { DiscordSignIn } from '../components/DiscordButton';
import { YourDuels } from '../duels/YourDuels';
import { YourRoundRobins } from '../tournaments/YourRoundRobins';
import { PlayerHistory } from '../games/PlayerHistory';
import { PlayerBlocks } from '../players/PlayerBlocks';
import { BotBadge, OpenTag, PresenceDot, Rating, provisionalNote } from '../components/player';
import { Sigil } from '../components/Sigil';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { meStore, useMe } from '../me';
import { Link } from '../router/Link';
import { navigate, useRoute } from '../router/use-route';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import './ProfileScreen.css';

export function ProfileScreen() {
    const route = useRoute();
    const state = useMe();
    const [deleted, setDeleted] = useState(false);
    useDocumentMeta(route);

    if (deleted) {
        return (
            <>
                <h1 className="screen-title">{text.profile.title}</h1>
                <Deleted />
            </>
        );
    }
    return (
        <>
            <h1 className="screen-title">{text.profile.title}</h1>
            {state.status === `loading` ? (
                <SkeletonRows />
            ) : state.me === null ? (
                <SignedOut />
            ) : state.me.kind === `guest` ? (
                <GuestIdentity me={state.me} />
            ) : (
                <UserIdentity me={state.me} />
            )}

            {state.status === `ready` && state.me?.kind === `user` ? (
                <>
                    <YourBots owner={state.me.name} />
                    <YourDuels />
                    <YourRoundRobins />
                    <PlayerBlocks name={state.me.name} />
                    <PlayerHistory player={state.me.name} title={text.games.yours} />
                    <AccountPanel
                        name={state.me.name}
                        optedOut={state.me.analysisOptOut}
                        onDeleted={() => {
                            setDeleted(true);
                        }}
                    />
                </>
            ) : null}
        </>
    );
}

// Said once, on the page the deletion happened on; the next visit reads signed out.
function Deleted() {
    const words = text.profile.account;
    return (
        <div className="card" role="status">
            <h2 className="card-title">{words.deleted}</h2>
            <p className="note">{words.deletedNote}</p>
            <p className="card-actions">
                <Link to="/" className="btn btn-ghost">
                    {words.home}
                </Link>
            </p>
        </div>
    );
}

function SignedOut() {
    return (
        <div className="card">
            <p className="note">{text.profile.signedOut}</p>
            <DiscordSignIn />
            <p className="card-actions">
                <Link to="/connect" className="btn btn-ghost">
                    {text.profile.build}
                </Link>
            </p>
        </div>
    );
}

// Ending a guest session ends its games; the card's sentence says so, as
// the identity menu's does, so neither asks twice.
function SignOutButton({ label, failure }: { label: string; failure: string }) {
    const [leaving, setLeaving] = useState(false);
    const [failed, setFailed] = useState(false);

    async function leave() {
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
                {label}
            </button>
            {failed ? (
                <p className="field-error" role="alert">
                    {failure}
                </p>
            ) : null}
        </>
    );
}

function UserIdentity({ me }: { me: UserMe }) {
    return (
        <div className="identity-plate">
            <span className="identity-monogram sigil-plate" aria-hidden="true">
                <Sigil nameKey={nameKeyOf(me.name)} />
            </span>
            <div className="identity-main">
                <span className="identity-name">{me.name}</span>
                <span className="identity-rating">
                    <span className="identity-number">
                        <Rating value={me.rating} provisional={me.provisional} />
                    </span>
                    <span className="note">{me.provisional ? provisionalNote : text.profile.rating}</span>
                </span>
                {me.discord === null ? null : <span className="note identity-discord">{text.profile.discord(me.discord)}</span>}
            </div>
            <SignOutButton label={text.profile.signOut} failure={text.profile.signOutFailed} />
        </div>
    );
}

function GuestIdentity({ me }: { me: GuestMe }) {
    return (
        <div className="identity-plate">
            <span className="identity-monogram sigil-plate" aria-hidden="true">
                <Sigil nameKey={null} />
            </span>
            <div className="identity-main">
                <span className="identity-name">{me.name}</span>
                <span className="note">{text.profile.guestNote}</span>
            </div>
            <div className="identity-actions">
                <DiscordSignIn guest />
                <SignOutButton label={text.profile.endGuest} failure={text.profile.endGuestFailed} />
            </div>
        </div>
    );
}

// The account's bots from the public directory; a bot the operator has
// delisted is absent there, so it is absent here too, and the note says so.
// The heading stands while they load, so the page below does not move when
// they land.
function YourBots({ owner }: { owner: string }) {
    const load = useCallback(async () => fetchBots(false), []);
    const { data, error, limited, loading, reload } = useAsync(load);
    const titleId = useId();
    const words = text.profile;
    const mine = (data ?? []).filter((bot) => bot.ownerName === owner);

    return (
        <section className="your-bots" aria-labelledby={titleId}>
            <div className="section-head">
                <h2 id={titleId} className="section-title">
                    {words.yourBots}
                </h2>
                {mine.length === 0 ? null : <span className="note">{words.botCount(mine.length)}</span>}
            </div>
            {loading && data === null ? (
                <SkeletonRows />
            ) : error && data === null ? (
                <ErrorFrame sentence={words.botsFailed} onRetry={reload} wait={limited} />
            ) : (
                <>
                    {mine.length === 0 ? (
                        <p className="note bot-rows-none">{words.noBots}</p>
                    ) : (
                        <ul className="bot-rows">
                            {mine.map((bot) => (
                                <BotRow key={bot.name} bot={bot} />
                            ))}
                        </ul>
                    )}
                    {mine.length < botCapPerUser ? (
                        <p className="bot-rows-foot">
                            <Link to="/connect" className={mine.length === 0 ? `btn btn-primary` : `btn btn-ghost`}>
                                {words.build}
                            </Link>
                            <span className="note">{words.delistedNote}</span>
                        </p>
                    ) : (
                        // Every bot the cap allows is listed, so none is delisted for the note to explain.
                        <p className="note bot-rows-foot">{words.atCap}</p>
                    )}
                </>
            )}
        </section>
    );
}

// The owner's token rotation and deletion live on the bot's page, so a row
// carries no actions of its own and leads there.
function BotRow({ bot }: { bot: BotListing }) {
    const words = text.profile;
    return (
        <li>
            <Link to={`/bots/${encodeURIComponent(bot.name)}`} className="bot-row">
                <span className="bot-row-name">
                    <span className="player-name">{bot.name}</span>
                    <BotBadge />
                </span>
                <span className="bot-row-state">
                    <span className="bot-row-presence">
                        <PresenceDot online={bot.online} />
                        {bot.online ? words.online : words.offline}
                    </span>
                    <span className="bot-row-open">
                        <OpenTag open={bot.openForChallenges} />
                    </span>
                    <span className="bot-row-facts">
                        {bot.analyzer === null ? null : <span>{words.analyzer}</span>}
                        {bot.levels === null ? null : <span>{words.strengths(bot.levels.list.length)}</span>}
                    </span>
                </span>
                <span className="bot-row-rating">
                    <Rating value={bot.rating} provisional={bot.provisional} />
                </span>
            </Link>
        </li>
    );
}
