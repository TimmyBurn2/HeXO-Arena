import { legalPagePath, legalPages, type LegalPage } from '@hexo-arena/contract';
import { reportForm } from '../report-form';
import { Link } from '../router/Link';
import { usePath, useSearch } from '../router/use-route';
import { legalPageLinks, licensesLink, reportLinkOf, type SiteLink } from '../site-links';
import type { Slot } from '../text/rich';
import { linksLegalPage, useLegal } from './documents';

/**
 * The footer's last group, and the drawer's: the legal pages the
 * deployment has, the licenses, and, where the deployment takes reports
 * through its form, the form about the page the group stands on.
 * Until the documents are read the group holds the licenses and the form alone.
 */
export function useLegalLinks(): readonly SiteLink[] {
    const legal = useLegal();
    const path = usePath();
    const search = useSearch();
    const present = legalPages.filter((page) => linksLegalPage(legal, page));
    return [...present.map((page) => legalPageLinks[page]), licensesLink, ...(reportForm.on() ? [reportLinkOf(`${path}${search}`)] : [])];
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
