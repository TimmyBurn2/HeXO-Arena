import type { ReactNode } from 'react';
import { Link } from '../router/Link';
import { text } from '../text';
import './LadderHead.css';

/**
 * A ladder page's heading with its two views, the ladder and the
 * tournaments, as links; a tournament's own page stands under the second.
 */
export function LadderHead({ view, title, children }: { view: `ladder` | `tournaments`; title: ReactNode; children?: ReactNode }) {
    return (
        <div className="ladder-head">
            <div className="ladder-head-row">
                <h1 className="screen-title">{title}</h1>
                <nav className="pills ladder-views" aria-label={text.tournaments.views}>
                    <Link to="/ladder" className={view === `ladder` ? `pill active` : `pill`} ariaCurrent={view === `ladder`}>
                        {text.tournaments.ladder}
                    </Link>
                    <Link to="/tournaments" className={view === `tournaments` ? `pill active` : `pill`} ariaCurrent={view === `tournaments`}>
                        {text.tournaments.title}
                    </Link>
                </nav>
            </div>
            {children}
        </div>
    );
}
