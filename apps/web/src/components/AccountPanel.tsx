import { useState } from 'react';
import { ApiError, fetchAccountData, limitedFor } from '../api/client';
import { meStore } from '../me';
import { text } from '../text';
import { ActionFailure, useWait } from './wait';
import './OwnerPanel.css';

// The browser saves the file under the server's name; the address lives
// only as long as the click needs it.
function save(file: Blob, name: string): void {
    const address = URL.createObjectURL(file);
    const link = document.createElement(`a`);
    link.href = address;
    link.download = name;
    link.click();
    setTimeout(() => {
        URL.revokeObjectURL(address);
    });
}

/**
 * What a person may do with their own account: take every record of it
 * home, offered first, keep their games out of public analysis, then delete
 * it, one typed name away.
 */
export function AccountPanel({ name, optedOut, onDeleted }: { name: string; optedOut: boolean; onDeleted: () => void }) {
    const words = text.profile.account;
    return (
        <section className="owner-panel card" aria-labelledby="account-title">
            <h2 id="account-title" className="owner-title">
                {words.title}
            </h2>
            <DownloadData />
            <AnalysisOptOut optedOut={optedOut} />
            <DeleteAccount name={name} onDeleted={onDeleted} />
        </section>
    );
}

function DownloadData() {
    const words = text.profile.account;
    const [failure, setFailure] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const limited = useWait();

    async function download() {
        setSending(true);
        setFailure(null);
        try {
            const { file, name } = await fetchAccountData();
            save(file, name);
        } catch (cause) {
            const wait = limitedFor(cause);
            if (wait === null) setFailure(words.downloadFailed);
            else limited.start(wait);
        }
        setSending(false);
    }

    return (
        <div className="owner-row">
            <div className="owner-text">
                <h3>{words.data}</h3>
                <p className="note">{words.dataNote}</p>
            </div>
            <button type="button" className="btn btn-ghost" disabled={sending || limited.wait !== null} onClick={() => void download()}>
                {words.download}
            </button>
            <ActionFailure failure={failure} wait={limited.wait} />
        </div>
    );
}

// The switch shows what the server holds, changing only once it answers.
function AnalysisOptOut({ optedOut }: { optedOut: boolean }) {
    const words = text.profile.account;
    const [failure, setFailure] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const limited = useWait();

    async function change(next: boolean) {
        setSending(true);
        setFailure(null);
        try {
            await meStore.update({ analysisOptOut: next });
        } catch (cause) {
            const wait = limitedFor(cause);
            if (wait === null) setFailure(words.optOutFailed);
            else limited.start(wait);
        }
        setSending(false);
    }

    return (
        <div className="owner-row">
            <div className="owner-text">
                <h3>{words.analysis}</h3>
                <p className="note" id="analysis-opt-out-note">
                    {words.optOutNote}
                </p>
            </div>
            <label className="checkline">
                <input
                    type="checkbox"
                    role="switch"
                    checked={optedOut}
                    disabled={sending || limited.wait !== null}
                    aria-describedby="analysis-opt-out-note"
                    onChange={(event) => void change(event.target.checked)}
                />
                {words.optOut}
            </label>
            <ActionFailure failure={failure} wait={limited.wait} />
        </div>
    );
}

function DeleteAccount({ name, onDeleted }: { name: string; onDeleted: () => void }) {
    const words = text.profile.account;
    const [typed, setTyped] = useState(``);
    const [failure, setFailure] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const limited = useWait();
    const confirmed = typed === name;

    async function remove() {
        setSending(true);
        setFailure(null);
        try {
            await meStore.deleteAccount(name, onDeleted);
        } catch (cause) {
            const wait = limitedFor(cause);
            if (wait !== null) {
                limited.start(wait);
            } else {
                const code = cause instanceof ApiError ? cause.code : null;
                setFailure(code === `in_live_game` ? words.inLiveGame : code === `name_mismatch` ? words.nameMismatch : words.deleteFailed);
            }
            setSending(false);
        }
    }

    return (
        <div className="owner-row">
            <div className="owner-text">
                <h3>{words.delete}</h3>
                <p className="note">{words.deleteNote(name)}</p>
            </div>
            <form
                className="name-field"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (confirmed) void remove();
                }}
            >
                <label className="field-label" htmlFor="account-delete-confirm">
                    {words.confirmName(name)}
                </label>
                <input
                    id="account-delete-confirm"
                    type="text"
                    value={typed}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => {
                        setTyped(event.target.value);
                    }}
                />
                <button type="submit" className="btn btn-danger" disabled={!confirmed || sending || limited.wait !== null}>
                    {words.confirm}
                </button>
            </form>
            <ActionFailure failure={failure} wait={limited.wait} />
        </div>
    );
}
