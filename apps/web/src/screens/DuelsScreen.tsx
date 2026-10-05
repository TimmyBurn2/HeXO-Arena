import { useState } from 'react';
import { duelsMeta } from '@hexo-arena/contract';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { NewDuel } from '../duels/NewDuel';
import { movedListPath, setupFromParams } from '../duels/setup';
import { eventReadiness } from '../play/readiness';
import { useMineDuels, useSetupReads } from '../duels/use-duels';
import { YourDuelsBeside } from '../duels/YourDuels';
import { useMe } from '../me';
import { PlayHead } from '../play/PlayHead';
import { playBotPath } from '../play/setup';
import { Link } from '../router/Link';
import { Moved } from '../router/Moved';
import { useRoute } from '../router/use-route';
import { useSiteStatus } from '../site-status';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import '../duels/Duels.css';
import './DuelsScreen.css';

/**
 * The Bot duel place under Play: a new duel's setup beside the reader's
 * own duels and tests, where one just started is found again.
 * A link may set the setup up, as a duel's Duel again does; an old link to
 * the lists that stood here goes on to the duels under Games.
 */
export function DuelsScreen() {
    const [moved] = useState(() => movedListPath(window.location.search));
    return moved === null ? <BotDuel /> : <Moved to={moved} />;
}

function BotDuel() {
    const route = useRoute();
    useDocumentMeta(route, duelsMeta.title, duelsMeta.description);
    const [initial] = useState(() => setupFromParams(new URLSearchParams(window.location.search)));
    const me = useMe();
    const paused = useSiteStatus() === `paused`;
    const self = me.status === `ready` ? me.me : undefined;
    const viewer = self?.kind === `user` ? self.name : null;
    const setup = useSetupReads();
    const mine = useMineDuels(viewer !== null);
    const reads = { reserved: setup.reserved, states: setup.states, viewer };
    const ready = setup.bots?.filter((bot) => eventReadiness(bot, [], reads, true) === null) ?? [];

    return (
        <>
            <PlayHead view="duel" />
            <div className="duels-layout">
                <div className="duels-main">
                    {setup.bots === null || self === undefined ? (
                        setup.failed ? (
                            <ErrorFrame sentence={text.duels.picker.listFailed} onRetry={setup.reload} wait={setup.limited} />
                        ) : (
                            <SkeletonRows />
                        )
                    ) : ready.length < 2 ? (
                        <div className="empty">
                            <h2>{text.duels.noneReady.heading}</h2>
                            <p>{text.duels.noneReady.body(ready.length)}</p>
                            <div className="actions">
                                {ready[0] === undefined ? null : (
                                    <Link to={playBotPath(ready[0].name)} className="btn btn-primary">
                                        {text.duels.noneReady.play(ready[0].name)}
                                    </Link>
                                )}
                                <Link to="/bots" className={ready[0] === undefined ? `btn btn-primary` : `btn btn-ghost`}>
                                    {text.duels.noneReady.browse}
                                </Link>
                            </div>
                        </div>
                    ) : (
                        <NewDuel bots={setup.bots} reads={reads} me={self} quota={mine.list?.quota ?? null} paused={paused} initial={initial} onRefused={setup.reload} />
                    )}
                </div>
                <aside className="duels-side">
                    {viewer === null ? <SignedOutSide /> : <YourDuelsBeside mine={mine} />}
                </aside>
            </div>
        </>
    );
}

// Signed out, the side says where every duel is watched instead.
function SignedOutSide() {
    const words = text.duels.lists;
    return (
        <section className="duel-list" aria-labelledby="your-duels-title">
            <div className="duel-list-head">
                <h2 id="your-duels-title" className="section-title">
                    {words.yoursTitle}
                </h2>
                <Link to="/games/duels">{words.allDuels}</Link>
            </div>
            <p className="note">{words.signIn}</p>
        </section>
    );
}
