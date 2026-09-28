import { siteName, siteTagline } from '@hexo-arena/contract';
import { legalLinks, siteLinks } from '../site-links';
import { SiteLinks } from './SiteLinks';
import './SiteFooter.css';

/**
 * The foot of every framed screen: what the site is, its standing links,
 * and the legal links as the last group, at the bottom right.
 */
export function SiteFooter() {
    return (
        <footer className="site-footer">
            <div className="site-footer-inner">
                <p className="site-tagline">
                    <span>{`${siteName},`}</span> <span>{siteTagline}</span>
                </p>
                <SiteLinks links={siteLinks} open="here" />
                <SiteLinks links={legalLinks} open="here" className="legal-links" />
            </div>
        </footer>
    );
}
