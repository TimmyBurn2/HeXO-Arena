import { Link } from '../router/Link';
import { reportPathOf } from '../site-links';
import { text } from '../text';
import './ReportLine.css';

/** The quiet way to report what a page shows, at its foot, the page named as the subject. */
export function ReportLine({ subject, name }: { subject: string; name: string }) {
    return (
        <p className="report-line">
            <Link to={reportPathOf(subject)}>{text.report.reportName(name)}</Link>
        </p>
    );
}
