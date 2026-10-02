import { useState, type SyntheticEvent } from 'react';
import { flushSync } from 'react-dom';
import {
    reportDetailsMaxLength,
    reportEmailMaxLength,
    reportNameMaxLength,
    reportReasons,
    reportRequestSchema,
    reportSubjectMaxLength,
    reportSubjectParam,
    reportSubjectSchema,
    type ReportReason,
} from '@hexo-arena/contract';
import { limitedFor, sendReport } from '../api/client';
import { ActionFailure, useWait } from '../components/wait';
import { useLegalSlots } from '../legal/links';
import { Link } from '../router/Link';
import { useRoute, useSearch } from '../router/use-route';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import './ReportScreen.css';

// A pasted address of this site reads as its path; anything else stays as
// typed, for the subject's own check to refuse.
function subjectOf(typed: string): string {
    const value = typed.trim();
    if (value.startsWith(`/`) || !URL.canParse(value)) return value;
    const url = new URL(value);
    return url.origin === window.location.origin ? `${url.pathname}${url.search}` : value;
}

// The page the form was opened from, when the link names one this site holds.
function subjectFromSearch(search: string): string {
    const named = new URLSearchParams(search).get(reportSubjectParam);
    return named !== null && reportSubjectSchema.safeParse(named).success ? named : ``;
}

const fields = [`subject`, `reason`, `details`, `name`, `email`, `goodFaith`] as const;
type Field = (typeof fields)[number];

// The fields a refused request names, by the key each check reports.
function fieldsAt(paths: readonly (readonly PropertyKey[])[]): Set<Field> {
    return new Set(fields.filter((field) => paths.some((path) => path[0] === field)));
}

/**
 * The report form: what a report is about, why, in the reporter's words,
 * who may be written back to, and the good-faith statement; it says so on
 * the screen once the report is stored.
 */
export function ReportScreen() {
    const route = useRoute();
    useDocumentMeta(route);
    const search = useSearch();
    const words = text.report;
    const legal = useLegalSlots();
    const [subject, setSubject] = useState(() => subjectFromSearch(search));
    const [reason, setReason] = useState<ReportReason | null>(null);
    const [details, setDetails] = useState(``);
    const [name, setName] = useState(``);
    const [email, setEmail] = useState(``);
    const [goodFaith, setGoodFaith] = useState(false);
    const [problems, setProblems] = useState<ReadonlySet<Field>>(new Set());
    const [sending, setSending] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const [sent, setSent] = useState<{ id: number; subject: string } | null>(null);
    const limited = useWait();

    async function send(event: SyntheticEvent) {
        event.preventDefault();
        const report = {
            subject: subjectOf(subject),
            reason,
            details,
            goodFaith,
            ...(name.trim() === `` ? {} : { name }),
            ...(email.trim() === `` ? {} : { email }),
        };
        const parsed = reportRequestSchema.safeParse(report);
        if (!parsed.success) {
            const invalid = fieldsAt(parsed.error.issues.map((issue) => issue.path));
            // The errors render before focus moves, so the field is read out
            // with its error, and a phone scrolls to it.
            flushSync(() => {
                setProblems(invalid);
            });
            const first = fields.find((field) => invalid.has(field));
            if (first !== undefined) document.getElementById(`report-${first}`)?.focus();
            return;
        }
        setProblems(new Set());
        setSending(true);
        setFailure(null);
        try {
            const receipt = await sendReport(parsed.data);
            setSent({ id: receipt.id, subject: parsed.data.subject });
        } catch (cause) {
            const wait = limitedFor(cause);
            if (wait === null) setFailure(words.failed);
            else limited.start(wait);
        }
        setSending(false);
    }

    function another() {
        setSent(null);
        setReason(null);
        setDetails(``);
        setGoodFaith(false);
    }

    if (sent !== null) {
        return (
            <>
                <h1 className="screen-title">{words.title}</h1>
                <div className="card report-sent" role="status">
                    <h2 className="card-title">{words.sent(sent.id)}</h2>
                    <p className="note">{words.sentNote}</p>
                    <p className="card-actions">
                        <Link to={sent.subject} className="btn btn-ghost">
                            {words.back}
                        </Link>
                        <button type="button" className="btn btn-ghost" onClick={another}>
                            {words.another}
                        </button>
                    </p>
                </div>
            </>
        );
    }

    const problem = (field: Field, line: string) =>
        problems.has(field) ? (
            <p className="field-error" id={`report-${field}-error`}>
                {line}
            </p>
        ) : null;
    const described = (field: Field, note?: string) => {
        const ids = [...(note === undefined ? [] : [note]), ...(problems.has(field) ? [`report-${field}-error`] : [])];
        return ids.length === 0 ? {} : { 'aria-describedby': ids.join(` `) };
    };

    return (
        <>
            <h1 className="screen-title">{words.title}</h1>
            <p className="report-lead">{words.lead}</p>
            <p className="note">{words.emergency}</p>
            <form className="report-form" noValidate onSubmit={(event) => void send(event)}>
                <div className="report-field">
                    <label className="field-label" htmlFor="report-subject">
                        {words.subject}
                    </label>
                    <input
                        id="report-subject"
                        type="text"
                        value={subject}
                        maxLength={reportSubjectMaxLength}
                        autoComplete="off"
                        spellCheck={false}
                        aria-invalid={problems.has(`subject`)}
                        {...described(`subject`, `report-subject-note`)}
                        onChange={(event) => {
                            setSubject(event.target.value);
                        }}
                    />
                    <p className="note" id="report-subject-note">
                        {words.subjectNote}
                    </p>
                    {problem(`subject`, words.subjectInvalid)}
                </div>
                <div className="report-field">
                    <label className="field-label" htmlFor="report-reason">
                        {words.reason}
                    </label>
                    <select
                        id="report-reason"
                        value={reason ?? ``}
                        aria-invalid={problems.has(`reason`)}
                        {...described(`reason`)}
                        onChange={(event) => {
                            setReason(reportReasons.find((option) => option === event.target.value) ?? null);
                        }}
                    >
                        <option value="">{words.reasonPick}</option>
                        {reportReasons.map((option) => (
                            <option key={option} value={option}>
                                {words.reasons[option]}
                            </option>
                        ))}
                    </select>
                    {problem(`reason`, words.reasonMissing)}
                </div>
                <div className="report-field">
                    <label className="field-label" htmlFor="report-details">
                        {words.details}
                    </label>
                    <textarea
                        id="report-details"
                        value={details}
                        maxLength={reportDetailsMaxLength}
                        rows={6}
                        aria-invalid={problems.has(`details`)}
                        {...described(`details`, `report-details-note`)}
                        onChange={(event) => {
                            setDetails(event.target.value);
                        }}
                    />
                    <p className="note" id="report-details-note">
                        {words.detailsNote}
                    </p>
                    {problem(`details`, words.detailsMissing)}
                </div>
                <fieldset className="report-field report-contact" aria-describedby="report-contact-note">
                    <legend className="field-label">{words.contact}</legend>
                    <label className="field-label" htmlFor="report-name">
                        {words.name}
                    </label>
                    <input
                        id="report-name"
                        type="text"
                        value={name}
                        maxLength={reportNameMaxLength}
                        autoComplete="name"
                        aria-invalid={problems.has(`name`)}
                        {...described(`name`)}
                        onChange={(event) => {
                            setName(event.target.value);
                        }}
                    />
                    {problem(`name`, words.nameInvalid)}
                    <label className="field-label" htmlFor="report-email">
                        {words.email}
                    </label>
                    <input
                        id="report-email"
                        type="email"
                        value={email}
                        maxLength={reportEmailMaxLength}
                        autoComplete="email"
                        aria-invalid={problems.has(`email`)}
                        {...described(`email`)}
                        onChange={(event) => {
                            setEmail(event.target.value);
                        }}
                    />
                    {problem(`email`, words.emailInvalid)}
                    <p className="note" id="report-contact-note">
                        {words.contactNote(legal.privacy)}
                    </p>
                </fieldset>
                <div className="report-field">
                    <label className="checkline report-good-faith">
                        <input
                            id="report-goodFaith"
                            type="checkbox"
                            checked={goodFaith}
                            aria-invalid={problems.has(`goodFaith`)}
                            {...described(`goodFaith`)}
                            onChange={(event) => {
                                setGoodFaith(event.target.checked);
                            }}
                        />
                        {words.goodFaith}
                    </label>
                    {problem(`goodFaith`, words.goodFaithMissing)}
                </div>
                <p className="card-actions">
                    <button type="submit" className="btn btn-primary" disabled={sending || limited.wait !== null}>
                        {words.send}
                    </button>
                </p>
                <ActionFailure failure={failure} wait={limited.wait} />
            </form>
        </>
    );
}
