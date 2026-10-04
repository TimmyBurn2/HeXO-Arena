import { useCallback, useState } from 'react';
import type { TournamentDetail } from '@hexo-arena/contract';
import { ApiError, enterTournament, fetchBots, withdrawTournamentEntry } from '../api/client';
import { useAsync } from '../api/use-async';
import { DiscordButton } from '../components/DiscordButton';
import { useMe } from '../me';
import { Link } from '../router/Link';
import { text } from '../text';

/**
 * A signed-in owner's entry while the tournament waits: one of their bots
 * entered, changed, or withdrawn, with what entering commits the bot to;
 * its heading one level under the block holding it, a page's own by default.
 */
export function EntryControl({ detail, onChange, level = 2 }: { detail: TournamentDetail; onChange: () => void; level?: 2 | 3 }) {
    const me = useMe();
    const self = me.status === `ready` && me.me?.kind === `user` ? me.me : null;
    const Heading = level === 2 ? `h2` : `h3`;
    return (
        <section className="tournament-block entry-control" aria-labelledby="tournament-entry-title">
            <Heading id="tournament-entry-title" className="section-title">
                {text.tournaments.entry.title}
            </Heading>
            <p className="note">{text.tournaments.entry.note}</p>
            {me.status === `loading` ? null : self === null ? (
                <div className="entry-sign-in">
                    <p>{text.tournaments.entry.signIn}</p>
                    <DiscordButton />
                </div>
            ) : (
                <OwnerEntry detail={detail} owner={self.name} onChange={onChange} />
            )}
        </section>
    );
}

function OwnerEntry({ detail, owner, onChange }: { detail: TournamentDetail; owner: string; onChange: () => void }) {
    const load = useCallback(async () => fetchBots(false), []);
    const roster = useAsync(load);
    const mine = (roster.data ?? []).filter((bot) => bot.ownerName === owner);
    const entered = detail.entries.find((entry) => entry.ownerName === owner) ?? null;
    const [picked, setPicked] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const choice = picked ?? mine.find((bot) => bot.name !== entered?.bot)?.name ?? mine[0]?.name ?? null;

    async function act(run: () => Promise<unknown>, failed: (cause: unknown) => string) {
        setBusy(true);
        setError(null);
        try {
            await run();
            onChange();
        } catch (cause) {
            setError(failed(cause));
        } finally {
            setBusy(false);
        }
    }

    function entryError(cause: unknown, bot: string): string {
        const errors = text.tournaments.entry.errors;
        const code = cause instanceof ApiError ? cause.code : null;
        return code !== null && code in errors ? errors[code as keyof typeof errors](bot) : text.tournaments.entry.failed;
    }

    if (roster.data === null) return null;
    if (mine.length === 0) {
        return (
            <p>
                {text.tournaments.entry.noBots}{` `}
                <Link to="/connect">{text.tournaments.entry.build}</Link>
            </p>
        );
    }
    const others = mine.filter((bot) => bot.name !== entered?.bot);
    return (
        <div className="entry-form">
            {entered === null ? null : (
                <p className="entry-yours">
                    <span>{text.tournaments.entry.yours(entered.bot)}</span>
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-disabled={busy ? `true` : undefined}
                        onClick={() => {
                            if (!busy) void act(async () => withdrawTournamentEntry(detail.id), () => text.tournaments.entry.withdrawFailed);
                        }}
                    >
                        {text.tournaments.entry.withdraw}
                    </button>
                </p>
            )}
            {others.length === 0 || choice === null ? null : (
                <form
                    className="entry-pick"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!busy) void act(async () => enterTournament(detail.id, choice), (cause) => entryError(cause, choice));
                    }}
                >
                    <div className="entry-field">
                        <label htmlFor="entry-bot">{text.tournaments.entry.bot}</label>
                        <select
                            id="entry-bot"
                            value={choice}
                            onChange={(event) => {
                                setPicked(event.target.value);
                            }}
                        >
                            {others.map((bot) => (
                                <option key={bot.name} value={bot.name}>
                                    {bot.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button type="submit" className="btn btn-primary" aria-disabled={busy ? `true` : undefined}>
                        {entered === null ? text.tournaments.entry.enter : text.tournaments.entry.change}
                    </button>
                </form>
            )}
            <p className="field-error" role="status">
                {error}
            </p>
        </div>
    );
}
