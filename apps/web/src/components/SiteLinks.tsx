import { Link } from '../router/Link';
import { usePath } from '../router/use-route';
import type { SiteLink } from '../site-links';
import { text } from '../text';
import { GitHubMark } from './GitHubMark';
import './SiteLinks.css';

/**
 * One group of the site's standing links as a list.
 * From a game each opens in a new tab and its name says so, so a seated
 * player never leaves a running clock.
 */
export function SiteLinks({ links, open, className }: { links: readonly SiteLink[]; open: `here` | `new-tab`; className?: string }) {
    return (
        <ul className={className === undefined ? `site-links` : `site-links ${className}`}>
            {links.map((link) => (
                <li key={link.label}>{open === `here` ? <HereLink link={link} /> : <NewTabLink link={link} />}</li>
            ))}
        </ul>
    );
}

function HereLink({ link }: { link: SiteLink }) {
    const path = usePath();
    if (link.kind === `page`) {
        return (
            <Link to={link.to} ariaCurrent={path === link.to}>
                {link.label}
            </Link>
        );
    }
    return (
        <a href={link.href} rel="noreferrer">
            {link.mark === `github` ? <GitHubMark /> : null}
            {link.label}
        </a>
    );
}

function NewTabLink({ link }: { link: SiteLink }) {
    return (
        <a
            href={link.kind === `page` ? link.to : link.href}
            target="_blank"
            rel="noreferrer"
            aria-label={text.shell.opensInNewTab(link.label)}
        >
            {link.kind === `external` && link.mark === `github` ? <GitHubMark /> : null}
            {link.label}
            <svg className="new-tab-mark" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 16L16 8M10 8h6v6" />
            </svg>
        </a>
    );
}
