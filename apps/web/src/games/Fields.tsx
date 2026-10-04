import { useState } from 'react';
import { nameMaxLength } from '@hexo-arena/contract';
import { text } from '../text';

/** A name field of the games filters, applying on Enter or when left, never mid-word. */
export function NameField({ id, label, value, disabled = false, wide = false, onCommit }: {
    id: string;
    label: string;
    value: string | undefined;
    disabled?: boolean;
    // A field naming one event takes the panel's whole row.
    wide?: boolean;
    onCommit: (name: string | undefined) => void;
}) {
    const [draft, setDraft] = useState(value ?? ``);
    const [shown, setShown] = useState(value);
    if (shown !== value) {
        setShown(value);
        setDraft(value ?? ``);
    }
    function commit() {
        const name = draft.trim();
        if (name !== (value ?? ``)) onCommit(name === `` ? undefined : name);
    }
    return (
        <div className={wide ? `games-field games-field-wide` : `games-field`}>
            <label htmlFor={id}>{label}</label>
            <input
                id={id}
                type="text"
                value={draft}
                maxLength={nameMaxLength}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                    setDraft(event.target.value);
                }}
                onBlur={commit}
                onKeyDown={(event) => {
                    if (event.key !== `Enter`) return;
                    event.preventDefault();
                    commit();
                }}
            />
        </div>
    );
}

/** A choice of the games filters, Any first. */
export function Choice<V extends string>({ id, label, describedBy, value, options, disabled = false, wide = false, onChange }: {
    id: string;
    label: string;
    describedBy?: string;
    value: V | undefined;
    options: readonly (readonly [V, string])[];
    disabled?: boolean;
    // A field naming one event takes the panel's whole row.
    wide?: boolean;
    onChange: (value: V | undefined) => void;
}) {
    return (
        <div className={wide ? `games-field games-field-wide` : `games-field`}>
            <label htmlFor={id}>{label}</label>
            <select
                id={id}
                value={value ?? ``}
                disabled={disabled}
                aria-describedby={describedBy}
                onChange={(event) => {
                    onChange(options.find(([option]) => option === event.target.value)?.[0]);
                }}
            >
                <option value="">{text.games.any}</option>
                {options.map(([option, words]) => (
                    <option key={option} value={option}>
                        {words}
                    </option>
                ))}
            </select>
        </div>
    );
}
