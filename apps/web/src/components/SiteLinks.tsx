import { Link } from '../router/Link';
import { usePath } from '../router/use-route';
import { siteLinks, type SiteLink } from '../site-links';
import './SiteLinks.css';

/**
 * The site's standing links as a list.
 * From a game each opens in a new tab and its name says so, so a seated
 * player never leaves a running clock.
 */
export function SiteLinks({ open }: { open: `here` | `new-tab` }) {
    return (
        <ul className="site-links">
            {siteLinks.map((link) => (
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
            aria-label={`${link.label}, opens in a new tab`}
        >
            {link.label}
            <svg className="new-tab-mark" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 16L16 8M10 8h6v6" />
            </svg>
        </a>
    );
}
