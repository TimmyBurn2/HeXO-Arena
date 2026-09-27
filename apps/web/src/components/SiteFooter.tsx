import { SiteLinks } from './SiteLinks';
import './SiteFooter.css';

/** The foot of every framed screen: what the site is, and its standing links. */
export function SiteFooter() {
    return (
        <footer className="site-footer">
            <div className="site-footer-inner">
                <p className="site-tagline">hexarena, a bot arena for HeXO</p>
                <SiteLinks open="here" />
            </div>
        </footer>
    );
}
