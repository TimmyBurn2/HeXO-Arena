import { useState } from 'react';
import { discordLoginPath, namePattern, isReservedName } from '@hexarena/contract';
import { ApiError, createBot } from '../api/client';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { useDocumentMeta } from '../use-document-meta';

const exampleRepo = `https://github.com/TimmyBurn2/Hexo-Bot-Api`;
const exampleBot = `https://github.com/TimmyBurn2/Hexo-Bot-Api/blob/main/examples/simple_bot.py`;

interface Created {
    name: string;
    token: string;
}

export function ConnectScreen() {
    const route = useRoute();
    useDocumentMeta(route);
    const [created, setCreated] = useState<Created | null>(null);

    return (
        <>
            <h1 className="screen-title">Connect</h1>
            <p className="note">
                the numbered path from sign-in to a first game; an account owns
                up to three bots
            </p>
            <ol className="steps">
                <li>
                    <span className="step-n" aria-hidden="true">
                        1
                    </span>
                    <div className="step-body">
                        <h2 className="step-title">Sign in with Discord</h2>
                        <p>Discord is the only login; no password is ever stored.</p>
                        <a className="btn btn-primary" href={discordLoginPath}>
                            Sign in with Discord
                        </a>
                    </div>
                </li>
                <li className={created === null ? `active` : `done`}>
                    <span className="step-n" aria-hidden="true">
                        2
                    </span>
                    <div className="step-body">
                        <h2 className="step-title">Create your bot</h2>
                        <CreateBotForm onCreated={setCreated} />
                    </div>
                </li>
                <li className={created === null ? `` : `active`}>
                    <span className="step-n" aria-hidden="true">
                        3
                    </span>
                    <div className="step-body">
                        <h2 className="step-title">Copy the token</h2>
                        {created === null ? (
                            <p>the token appears once, right after creation.</p>
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
                        <h2 className="step-title">Run the example</h2>
                        <p>
                            a ready loop against the stream, in python:{` `}
                            <a href={exampleRepo} rel="noreferrer" target="_blank">
                                the Hexo-Bot-Api readme
                            </a>
                            {` `}and{` `}
                            <a href={exampleBot} rel="noreferrer" target="_blank">
                                simple_bot.py
                            </a>
                        </p>
                    </div>
                </li>
                <li>
                    <span className="step-n" aria-hidden="true">
                        5
                    </span>
                    <div className="step-body">
                        <h2 className="step-title">Watch it play</h2>
                        {created === null ? (
                            <p>your bot appears in the directory once its stream opens.</p>
                        ) : (
                            <p>
                                your bot lives at <Link to={`/bots/${encodeURIComponent(created.name)}`}>its page</Link>
                            </p>
                        )}
                    </div>
                </li>
                <li>
                    <span className="step-n" aria-hidden="true">
                        6
                    </span>
                    <div className="step-body">
                        <h2 className="step-title">Read the spec</h2>
                        <p>
                            endpoints and events, with examples:{` `}
                            <a href={exampleRepo} rel="noreferrer" target="_blank">
                                Hexo-Bot-Api
                            </a>
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
        if (!namePattern.test(value)) {
            return `letters first, then letters, digits, - or _; 2 to 30 characters`;
        }
        if (isReservedName(value)) return `that name is reserved`;
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
                setFailure(`the bot could not be created; try again`);
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
                <input
                    id="bot-name"
                    type="text"
                    value={name}
                    aria-label="bot name"
                    autoComplete="off"
                    onChange={(event) => {
                        setName(event.target.value);
                    }}
                />
                <button type="submit" className="btn btn-primary" disabled={!submittable}>
                    Create bot
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
            return `letters first, then letters, digits, - or _; 2 to 30 characters`;
        case `name_reserved`:
            return `that name is reserved`;
        case `name_taken`:
            return `that name is taken`;
        case `bot_limit`:
            return `you already hold the bot cap`;
        case `unauthorized`:
            return `sign in first; step 1 opens Discord`;
        default:
            return `the bot could not be created; try again`;
    }
}

function TokenBox({ token }: { token: string }) {
    const [copied, setCopied] = useState(false);

    async function copy() {
        try {
            await navigator.clipboard.writeText(token);
            setCopied(true);
        } catch {
            setCopied(false);
        }
    }

    return (
        <>
            <div className="token-box">
                <span className="token-value">{token}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()}>
                    {copied ? `Copied` : `Copy`}
                </button>
            </div>
            <p className="warn">
                the token shows once; if it is lost, rotate it from the bot page
            </p>
        </>
    );
}
