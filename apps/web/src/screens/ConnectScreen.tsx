import { useState } from 'react';
import { namePattern, isReservedName } from '@hexarena/contract';
import { ApiError, createBot } from '../api/client';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { DiscordSignIn } from '../components/DiscordButton';
import { TokenBox } from '../components/TokenBox';
import { useMe } from '../me';
import { useDocumentMeta } from '../use-document-meta';
import './ConnectScreen.css';

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
    const state = useMe();
    const me = state.status === `ready` ? state.me : null;

    return (
        <>
            <h1 className="screen-title">Connect</h1>
            <p className="note">
                The numbered path from sign-in to a first game; an account owns
                up to three bots.
            </p>
            <ol className="steps">
                <li className={me?.kind === `user` ? `done` : `active`}>
                    <span className="step-n" aria-hidden="true">
                        1
                    </span>
                    <div className="step-body">
                        {me?.kind === `user` ? (
                            <>
                                <h2 className="step-title">Signed in as {me.name}</h2>
                                <p>
                                    Your bots gather in <Link to="/profile">Profile</Link>.
                                </p>
                            </>
                        ) : (
                            <>
                                <h2 className="step-title">Sign in</h2>
                                {me?.kind === `guest` ? (
                                    <p>You are playing as {me.name}; owning a bot takes an account.</p>
                                ) : null}
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
                            <p>The token appears once, right after creation.</p>
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
                            A ready loop against the stream, in python:{` `}
                            <a href={exampleRepo} rel="noreferrer" target="_blank">
                                the Hexo-Bot-Api readme
                            </a>
                            {` `}and{` `}
                            <a href={exampleBot} rel="noreferrer" target="_blank">
                                simple_bot.py
                            </a>.
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
                            <p>Your bot appears in the directory once its stream opens.</p>
                        ) : (
                            <p>
                                Your bot lives at <Link to={`/bots/${encodeURIComponent(created.name)}`}>its page</Link>.
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
                            Endpoints and events, with examples:{` `}
                            <a href={exampleRepo} rel="noreferrer" target="_blank">
                                Hexo-Bot-Api
                            </a>.
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
            return `Letters first, then letters, digits, - or _; 2 to 30 characters`;
        }
        if (isReservedName(value)) return `That name is reserved`;
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
                setFailure(`The bot could not be created; try again`);
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
            return `Letters first, then letters, digits, - or _; 2 to 30 characters`;
        case `name_reserved`:
            return `That name is reserved`;
        case `name_taken`:
            return `That name is taken`;
        case `bot_limit`:
            return `You already hold the bot cap`;
        case `unauthorized`:
            return `Sign in first; step 1 opens Discord`;
        default:
            return `The bot could not be created; try again`;
    }
}
