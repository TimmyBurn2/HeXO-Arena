import type { CSSProperties } from 'react';
import type { DuelEstimate, DuelSide } from '@hexo-arena/contract';
import { Rating } from '../components/player';
import { text } from '../text';
import { pointsText, signed, sweptBy } from './words';
import './Duels.css';

/** What an estimate of two bots says beside its figures: each bot and its rating now, whether games are still to come, how many, and how many ended without a winner. */
export interface EstimateSubject {
    readonly first: EstimateBot;
    readonly second: EstimateBot;
    readonly running: boolean;
    readonly games: number;
    readonly noWinner: number;
}

interface EstimateBot {
    readonly name: string;
    readonly now: { readonly rating: number; readonly provisional: boolean } | null;
}

// The axis runs this far either way, in rating points; an estimate past it sits at its end.
const axisReach = 400;
const ticks = [-400, -200, 0, 200, 400] as const;

// A rating difference as a share of the axis, from its left end.
function at(value: number): string {
    const clamped = Math.min(axisReach, Math.max(-axisReach, value));
    return `${String(((clamped + axisReach) / (2 * axisReach)) * 100)}%`;
}

const otherSide = (side: DuelSide): DuelSide => (side === `first` ? `second` : `first`);

/**
 * A test's estimate, led by the score: how many rating points the leading
 * bot is stronger, with its 95% range on an axis around zero, the chance
 * it is the stronger, the verdict, and the ladder as it stands, which a
 * test moves for neither bot. A sweep's range has no upper end, so it is
 * said as the least the bot is stronger by.
 */
export function Estimate({ duel, estimate }: { duel: EstimateSubject; estimate: DuelEstimate }) {
    const words = text.duels.estimate;
    // The bot the estimate favors leads every line; the first named at even.
    const lead: DuelSide = estimate.favored ?? `first`;
    const trail = otherSide(lead);
    const flip = lead === `second`;
    const rating = flip ? -estimate.rating : estimate.rating;
    const low = flip ? (estimate.high === null ? null : -estimate.high) : estimate.low;
    const high = flip ? (estimate.low === null ? null : -estimate.low) : estimate.high;
    const chance = flip ? 1 - estimate.chance : estimate.chance;
    const leadName = duel[lead].name;
    const trailName = duel[trail].name;
    const points = { lead: pointsText(estimate.points[lead]), trail: pointsText(estimate.points[trail]) };
    const running = duel.running;
    const swept = sweptBy(estimate) !== null;
    const level = estimate.favored === null;
    const drawn = text.duels.noWinner(duel.noWinner);
    const head = swept
        ? words.sweep(leadName, estimate.games)
        : level
          ? running
              ? words.level(points.lead, estimate.games, duel.games, drawn)
              : words.levelOver(points.lead, drawn)
          : running
            ? words.soFar(leadName, points.lead, points.trail, estimate.games, duel.games, drawn)
            : words.scored(leadName, points.lead, points.trail, drawn);
    const range = words.between(low, high);
    // A range open upward has no middle worth a number, so only its floor is said.
    const value =
        high === null && low !== null
            ? words.pointsAtLeast(signed(low))
            : words.pointsValue(signed(rating), words.pointsRange(low === null ? words.open : signed(low), high === null ? words.open : signed(high)));
    const line = level ? words.even(trailName, range) : swept && high === null && low !== null && low > 0 ? words.atLeast(low, trailName) : words.line(rating, trailName, range);
    const from = low ?? -axisReach;
    const to = high ?? axisReach;
    const band: CSSProperties = { [`--from` as string]: at(from), [`--span` as string]: `calc(${at(to)} - ${at(from)})` };
    return (
        <section className="estimate" aria-labelledby="estimate-title">
            <div className="estimate-head">
                <h2 id="estimate-title" className="estimate-title">
                    {head}
                </h2>
                <span className={estimate.verdict === `too_close` ? `tag muted` : `tag`}>{words.verdicts[estimate.verdict]}</span>
            </div>
            <p className="estimate-line">{line}</p>
            <div className="estimate-figure" role="img" aria-label={`${words.axis}: ${value}`}>
                <div className="estimate-ends" aria-hidden="true">
                    <span>{words.stronger(trailName)}</span>
                    <span>{words.stronger(leadName)}</span>
                </div>
                <div className="est-axis" aria-hidden="true">
                    <div className="est-track">
                        <span className="est-line" />
                        <span className="est-band" style={band} />
                        <span className="est-zero" style={{ [`--at` as string]: at(0) }} />
                        <span className="est-mark" style={{ [`--at` as string]: at(rating) }} />
                        {ticks.map((tick) => (
                            <span key={tick} className="est-tick" style={{ [`--at` as string]: at(tick) }}>
                                {words.tick(tick)}
                            </span>
                        ))}
                    </div>
                </div>
            </div>
            <dl className="estimate-facts">
                <div>
                    <dt>{words.chance(leadName)}</dt>
                    <dd>{words.percent(chance)}</dd>
                </div>
                <div>
                    <dt>{words.ratingPoints}</dt>
                    <dd>{value}</dd>
                </div>
                <div>
                    <dt>{words.ladderNow}</dt>
                    <dd>{words.ladderValue(<LadderBot duel={duel} side={lead} />, <LadderBot duel={duel} side={trail} />)}</dd>
                </div>
            </dl>
            <p className="note">
                {running ? words.toGo(duel.games - estimate.games) : estimate.narrowed === null ? null : words.narrowed(estimate.narrowed)}
            </p>
        </section>
    );
}

function LadderBot({ duel, side }: { duel: EstimateSubject; side: DuelSide }) {
    const bot = duel[side];
    const now = bot.now;
    return now === null ? bot.name : text.duels.estimate.ladderBot(bot.name, <Rating value={now.rating} provisional={now.provisional} />);
}
