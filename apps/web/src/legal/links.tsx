import { legalPagePath, legalPages, type LegalPage } from '@hexo-arena/contract';
import { Link } from '../router/Link';
import { legalPageLinks, licensesLink, type SiteLink } from '../site-links';
import type { Slot } from '../text/rich';
import { linksLegalPage, useLegal } from './documents';

/**
 * The footer's last group, and the drawer's: the legal pages the
 * deployment has, then the licenses.
 * Until the documents are read the group holds the licenses alone.
 */
export function useLegalLinks(): readonly SiteLink[] {
    const legal = useLegal();
    const present = legalPages.filter((page) => linksLegalPage(legal, page));
    return [...present.map((page) => legalPageLinks[page]), licensesLink];
}

/**
 * A link to each legal page as a slot for running text, or null for a
 * page the deployment lacks, which the sentence then leaves out.
 * `onNavigate` runs before a link navigates, so a panel holding it can
 * close first.
 */
export function useLegalSlots(onNavigate?: () => void): Readonly<Record<LegalPage, Slot | null>> {
    const legal = useLegal();
    const slot = (page: LegalPage): Slot | null =>
        linksLegalPage(legal, page)
            ? (words) => (
                  <Link to={legalPagePath(page)} {...(onNavigate === undefined ? {} : { onNavigate })}>
                      {words}
                  </Link>
              )
            : null;
    return { imprint: slot(`imprint`), privacy: slot(`privacy`), terms: slot(`terms`) };
}
