import { useCallback, useEffect } from 'react';
import { notFoundMeta, playerMeta } from '@hexo-arena/contract';
import { ApiError, fetchPlayerRecord } from '../api/client';
import { useAsync } from '../api/use-async';
import { Rating } from '../components/player';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { PlayerHistory } from '../games/PlayerHistory';
import { PendingPlate } from '../players/PendingPlate';
import { PlayerBlocks } from '../players/PlayerBlocks';
import { ReportLine } from '../components/ReportLine';
import { Link } from '../router/Link';
import { navigate, useRoute } from '../router/use-route';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import './BotScreen.css';

/**
 * A human player's public page: the rating and its chart, the record, the
 * opponents met most, and the latest games; a bot's name leads to its own
 * page instead.
 */
export function PlayerScreen({ name }: { name: string }) {
    const route = useRoute();
    // A name no player holds, a deleted player's placeholder included, reads as null.
    const load = useCallback(async () => {
        try {
            return await fetchPlayerRecord(name);
        } catch (cause) {
            if (cause instanceof ApiError && cause.status === 404) return null;
            throw cause;
        }
    }, [name]);
    const { data: found, error, limited, loading, reload } = useAsync(load);
    const data = found ?? null;
    const meta = data !== null ? playerMeta(data.name, data) : found === null && !loading ? notFoundMeta : undefined;
    useDocumentMeta(route, meta?.title, meta?.description);

    useEffect(() => {
        if (data?.kind === `bot`) navigate(`/bots/${encodeURIComponent(data.name)}`, { replace: true });
    }, [data]);

    const tag = <span className="tag muted">{text.players.human}</span>;
    if (loading && data === null) {
        return (
            <>
                <PendingPlate name={name} tag={tag} />
                <SkeletonRows />
            </>
        );
    }
    if (error && data === null) {
        return (
            <>
                <PendingPlate name={name} tag={tag} />
                <ErrorFrame sentence={text.players.failed} onRetry={reload} wait={limited} />
            </>
        );
    }
    if (data === null) return <Missing name={name} />;
    if (data.kind === `bot`) return null;
    return (
        <>
            <div className="bot-lift">
                <header className="bot-plate">
                    <div className="bot-title">
                        <h1>{data.name}</h1>
                        {tag}
                    </div>
                    <div className="bot-rating">
                        <span className="bot-rating-number">
                            <Rating value={data.rating} provisional={data.provisional} />
                        </span>
                        <span className="note">{data.provisional ? text.players.provisionalRating : text.players.rating}</span>
                    </div>
                </header>
            </div>
            <PlayerBlocks name={data.name} />
            <PlayerHistory player={data.name} title={text.games.recent} />
            <ReportLine subject={`/players/${encodeURIComponent(data.name)}`} name={data.name} />
        </>
    );
}

function Missing({ name }: { name: string }) {
    return (
        <div className="empty">
            <h1>{text.players.missing(name)}</h1>
            <p>{text.players.missingBody}</p>
            <div className="actions">
                <Link to="/ladder" className="btn btn-ghost">
                    {text.players.browse}
                </Link>
            </div>
        </div>
    );
}
