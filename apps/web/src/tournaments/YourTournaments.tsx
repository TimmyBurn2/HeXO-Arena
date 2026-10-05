import { useCallback } from 'react';
import { fetchTournaments } from '../api/client';
import { useAsync } from '../api/use-async';
import { Link } from '../router/Link';
import { text } from '../text';
import { TournamentRow } from './TournamentRow';
import { gamesTournamentsPath } from './view';
import '../duels/Duels.css';
import './RoundRobin.css';

// A profile shows this many; the rest are a link away.
const shown = 3;

/**
 * The signed-in person's duels and round robins on their Profile, as
 * Games lists them under Yours: those they set up and those their bots
 * play, live first, then a link to the rest; nothing at all while there
 * are none.
 */
export function YourTournaments() {
    const load = useCallback(async () => fetchTournaments({ mine: `1` }), []);
    const { data } = useAsync(load);
    const mine = data === null ? [] : [...data.running, ...data.past].filter((tournament) => tournament.origin === `person`).slice(0, shown);
    if (mine.length === 0) return null;
    const words = text.roundRobins.side;
    return (
        <section className="duel-list your-duels" aria-labelledby="your-tournaments-title">
            <h2 id="your-tournaments-title" className="section-title">
                {words.yours}
            </h2>
            <ul className="duel-rows">
                {mine.map((tournament) => (
                    <li key={tournament.id}>
                        <TournamentRow tournament={tournament} compact />
                    </li>
                ))}
            </ul>
            <p className="your-duels-foot">
                <Link to={gamesTournamentsPath(`yours`)}>{words.allYours}</Link>
            </p>
        </section>
    );
}
