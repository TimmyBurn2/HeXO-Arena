import { useCallback } from 'react';
import type { TournamentList } from '@hexo-arena/contract';
import { fetchBotTournaments } from '../api/client';
import { useAsync } from '../api/use-async';
import { Link } from '../router/Link';
import { text } from '../text';
import { PlaceRows } from '../tournaments/PlaceRows';
import { gamesTournamentsPath } from '../tournaments/view';
import '../duels/Duels.css';

// A bot page shows this many; the rest are a link away.
const shownOnPage = 5;

function latestTournaments(list: TournamentList | null) {
    return list === null ? [] : [...list.running, ...list.scheduled, ...list.past].slice(0, shownOnPage);
}

/**
 * A bot's tournaments, its duels, round robins, and tests among them, and
 * the weekly, each with the bot's part: live or coming first, then the
 * latest over; a bot in none shows nothing.
 */
export function BotEvents({ bot, owner }: { bot: string; owner: string | null }) {
    const load = useCallback(async () => fetchBotTournaments(bot), [bot]);
    const tournaments = latestTournaments(useAsync(load).data);
    if (tournaments.length === 0) return null;
    return (
        <div className="bot-duels">
            <section className="duel-list" aria-labelledby="bot-tournaments-title">
                <div className="duel-list-head">
                    <h2 id="bot-tournaments-title" className="section-title">
                        {text.tournaments.bot.title}
                    </h2>
                    <Link to={gamesTournamentsPath(null, bot)}>{text.tournaments.bot.all}</Link>
                </div>
                <PlaceRows tournaments={tournaments} />
                {owner === null || !tournaments.some((tournament) => tournament.test) ? null : <p className="note">{text.duels.bot.testsNote(owner)}</p>}
            </section>
        </div>
    );
}
