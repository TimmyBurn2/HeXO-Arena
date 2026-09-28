import { useState } from 'react';
import { namePattern, isReservedName } from '@hexo-arena/contract';
import { ApiError, createBot } from '../api/client';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { DiscordSignIn } from '../components/DiscordButton';
import { TokenBox } from '../components/TokenBox';
import { useMe } from '../me';
import { botApiRepository } from '../site-links';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import './ConnectScreen.css';

const exampleBot = `${botApiRepository}/blob/main/examples/simple_bot.py`;

interface Created {
    name: string;
    token: string;
}

export function ConnectScreen() {
    const route = useRoute();
    useDocumentMeta(route);
    const [created, setCreated] = useState<Created | null>(null);
    const state = useMe();
    const me = state.status === `ready` ? state.me : null;

    return (
        <>
            <h1 className="screen-title">{text.build.title}</h1>
            <p className="note">{text.build.lead}</p>
            <ol className="steps">
                <li className={me?.kind === `user` ? `done` : `active`}>
                    <span className="step-n" aria-hidden="true">
                        1
                    </span>
                    <div className="step-body">
                        {me?.kind === `user` ? (
                            <>
                                <h2 className="step-title">{text.build.signedInAs(me.name)}</h2>
                                <p>{text.build.profileNote((words) => <Link to="/profile">{words}</Link>)}</p>
                            </>
                        ) : (
                            <>
                                <h2 className="step-title">{text.build.signIn}</h2>
                                {me?.kind === `guest` ? <p>{text.build.guestNote(me.name)}</p> : null}
                                <DiscordSignIn />
                            </>
                        )}
                    </div>
                </li>
                <li className={me?.kind !== `user` ? `` : created === null ? `active` : `done`}>
                    <span className="step-n" aria-hidden="true">
                        2
                    </span>
                    <div className="step-body">
                        <h2 className="step-title">{text.build.create}</h2>
                        <CreateBotForm onCreated={setCreated} />
                    </div>
                </li>
                <li className={created === null ? `` : `active`}>
                    <span className="step-n" aria-hidden="true">
                        3
                    </span>
                    <div className="step-body">
                        <h2 className="step-title">{text.build.copyToken}</h2>
                        {created === null ? (
                            <p>{text.build.tokenLater}</p>
                        ) : (
                            <TokenBox token={created.token} />
                        )}
                    </div>
                </li>
                <li>
                    <span className="step-n" aria-hidden="true">
                        4
                    </span>
                    <div className="step-body">
                        <h2 className="step-title">{text.build.runExample}</h2>
                        <p>
                            {text.build.example(
                                (words) => (
                                    <a href={exampleBot} rel="noreferrer" target="_blank">
                                        {words}
                                    </a>
                                ),
                                (words) => (
                                    <a href={botApiRepository} rel="noreferrer" target="_blank">
                                        {words}
                                    </a>
                                ),
                            )}
                        </p>
                    </div>
                </li>
                <li>
                    <span className="step-n" aria-hidden="true">
                        5
                    </span>
                    <div className="step-body">
                        <h2 className="step-title">{text.build.watch}</h2>
                        {created === null ? (
                            <p>{text.build.watchLater((words) => <Link to="/bots">{words}</Link>)}</p>
                        ) : (
                            <p>
                                {text.build.botPage(<Link to={`/bots/${encodeURIComponent(created.name)}`}>{created.name}</Link>)}
                            </p>
                        )}
                    </div>
                </li>
                <li>
                    <span className="step-n" aria-hidden="true">
                        6
                    </span>
                    <div className="step-body">
                        <h2 className="step-title">{text.build.readApi}</h2>
                        <p>
                            {text.build.api((words) => (
                                <a href={botApiRepository} rel="noreferrer" target="_blank">
                                    {words}
                                </a>
                            ))}
                        </p>
                    </div>
                </li>
            </ol>
        </>
    );
}

function CreateBotForm({ onCreated }: { onCreated: (created: Created) => void }) {
    const [name, setName] = useState(``);
    const [failure, setFailure] = useState<string | null>(null);
    const [sending, setSending] = useState(false);

    function liveProblem(value: string): string | null {
        if (value === ``) return null;
        if (!namePattern.test(value)) return text.build.nameRule;
        if (isReservedName(value)) return text.build.reserved;
        return null;
    }

    async function submit() {
        setSending(true);
        setFailure(null);
        try {
            onCreated(await createBot(name));
        } catch (cause) {
            if (cause instanceof ApiError) {
                setFailure(createErrorSentence(cause));
            } else {
                setFailure(text.build.failed);
            }
            setSending(false);
        }
    }

    const problem = liveProblem(name);
    const submittable = name !== `` && problem === null && !sending;

    return (
        <>
            <form
                className="name-field"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (submittable) void submit();
                }}
            >
                <label className="field-label" htmlFor="bot-name">
                    {text.build.nameLabel}
                </label>
                <input
                    id="bot-name"
                    type="text"
                    value={name}
                    autoComplete="off"
                    onChange={(event) => {
                        setName(event.target.value);
                    }}
                />
                <button type="submit" className="btn btn-primary" disabled={!submittable}>
                    {text.build.createBot}
                </button>
            </form>
            {problem !== null ? (
                <p className="field-error" role="alert">
                    {problem}
                </p>
            ) : null}
            {failure !== null ? (
                <p className="field-error" role="alert">
                    {failure}
                </p>
            ) : null}
        </>
    );
}

function createErrorSentence(error: ApiError): string {
    switch (error.code) {
        case `invalid_name`:
            return text.build.nameRule;
        case `name_reserved`:
            return text.build.reserved;
        case `name_taken`:
            return text.build.taken;
        case `bot_limit`:
            return text.build.atCap;
        case `unauthorized`:
            return text.build.signInFirst;
        default:
            return text.build.failed;
    }
}
