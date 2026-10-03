import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { namePattern, isReservedName, type AccountDeclaration, type AnalyzerDeclaration } from '@hexo-arena/contract';
import { ApiError, createBot, limitedFor } from '../api/client';
import { useWait, WaitText } from '../components/wait';
import { CodeBlock } from '../components/CodeBlock';
import { Link } from '../router/Link';
import { landed, landingOf, useRoute } from '../router/use-route';
import { DiscordSignIn } from '../components/DiscordButton';
import { TokenBox } from '../components/TokenBox';
import { useMe } from '../me';
import { botApiRepository, bridgeInstall, bridgeRepository } from '../site-links';
import { text } from '../text';
import type { Slot } from '../text/rich';
import { useDocumentMeta } from '../use-document-meta';
import './ConnectScreen.css';

const exampleBot = `${botApiRepository}/blob/main/examples/simple_bot.py`;
const exampleEngine = `${bridgeRepository}/blob/main/examples/random_engine.py`;
const bridgeReadme = `${bridgeRepository}#readme`;

const code: Slot = (words) => <code>{words}</code>;

function outTo(href: string): Slot {
    return (words) => (
        <a href={href} rel="noreferrer" target="_blank">
            {words}
        </a>
    );
}

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
    const botName = useRef<HTMLInputElement>(null);
    const signedIn = me?.kind === `user`;
    // A bot connects to the site that served this page, so the samples
    // name its origin rather than any deployment's domain.
    const origin = window.location.origin;
    const words = text.build;
    const samples = words.samples;

    // An account made on the way here goes straight to its bot's name.
    useEffect(() => {
        if (!signedIn || landingOf() !== `bot-name`) return;
        botName.current?.focus();
        landed();
    }, [signedIn]);

    // Keyed by the contract's own fields, so one it adds cannot go undescribed;
    // about and repoUrl are left out, the owner setting the bot's text and link on its page.
    const analyzerFields: Pick<Record<keyof AnalyzerDeclaration, ReactNode>, `values`> = { values: words.declaration.values(code) };
    const declared: Record<Exclude<keyof AccountDeclaration, `about` | `repoUrl`>, ReactNode> = {
        accepts: words.declaration.accepts(code),
        version: words.declaration.version,
        levels: words.declaration.levels,
        analyzer: (
            <>
                {words.declaration.analyzer(code)}
                <Fields fields={analyzerFields} className="declaration-fields declaration-sub" />
            </>
        ),
    };

    return (
        <div className="build-guide">
            <h1 className="screen-title">{words.title}</h1>
            <p className="note">{words.lead}</p>
            <section className="build-part">
                <h2 className="section-title">{words.bridge.title}</h2>
                <p>{words.bridge.lead(outTo(bridgeRepository))}</p>
                <h3>{words.bridge.install}</h3>
                <p className="note">{words.bridge.installNote}</p>
                <CodeBlock {...samples.install} code={bridgeInstall} />
                <h3>{words.bridge.python}</h3>
                <p className="note">{words.bridge.pythonNote(code)}</p>
                <CodeBlock {...samples.python} code={samples.python.code(origin)} />
                <p className="note">{words.bridge.start}</p>
                <CodeBlock {...samples.startPython} />
                <h3>{words.bridge.process}</h3>
                <p className="note">{words.bridge.processNote(outTo(exampleEngine), outTo(bridgeReadme), code)}</p>
                <CodeBlock {...samples.toml} code={samples.toml.code(origin)} />
                <p className="note">{words.bridge.startBridge}</p>
                <CodeBlock {...samples.startBridge} />
            </section>
            <section className="build-part">
                <h2 className="section-title">{words.steps}</h2>
                <ol className="steps">
                    <li className={me?.kind === `user` ? `done` : `active`}>
                        <span className="step-n" aria-hidden="true">
                            1
                        </span>
                        <div className="step-body">
                            {me?.kind === `user` ? (
                                <>
                                    <h3 className="step-title">{words.signedInAs(me.name)}</h3>
                                    <p>{words.profileNote((profile) => <Link to="/profile">{profile}</Link>)}</p>
                                </>
                            ) : (
                                <>
                                    <h3 className="step-title">{words.signIn}</h3>
                                    {me?.kind === `guest` ? <p>{words.guestNote(me.name)}</p> : null}
                                    <DiscordSignIn guest={me?.kind === `guest`} />
                                </>
                            )}
                        </div>
                    </li>
                    <li className={me?.kind !== `user` ? `` : created === null ? `active` : `done`}>
                        <span className="step-n" aria-hidden="true">
                            2
                        </span>
                        <div className="step-body">
                            <h3 className="step-title">{words.create}</h3>
                            <CreateBotForm ref={botName} onCreated={setCreated} />
                        </div>
                    </li>
                    <li className={created === null ? `` : `active`}>
                        <span className="step-n" aria-hidden="true">
                            3
                        </span>
                        <div className="step-body">
                            <h3 className="step-title">{words.copyToken}</h3>
                            {created === null ? <p>{words.tokenLater}</p> : <TokenBox token={created.token} />}
                        </div>
                    </li>
                    <li>
                        <span className="step-n" aria-hidden="true">
                            4
                        </span>
                        <div className="step-body">
                            <h3 className="step-title">{words.watch}</h3>
                            {created === null ? (
                                <p>{words.watchLater((bots) => <Link to="/bots">{bots}</Link>)}</p>
                            ) : (
                                <p>{words.botPage(<Link to={`/bots/${encodeURIComponent(created.name)}`}>{created.name}</Link>)}</p>
                            )}
                        </div>
                    </li>
                </ol>
            </section>
            <section className="build-part">
                <h2 className="section-title">{words.declaration.title}</h2>
                <p>{words.declaration.lead(code)}</p>
                <Fields fields={declared} className="declaration-fields" />
            </section>
            <section className="build-part">
                <h2 className="section-title">{words.api.title}</h2>
                <p>{words.api.lead(outTo(botApiRepository))}</p>
                <p>{words.api.example(outTo(exampleBot), outTo(botApiRepository))}</p>
            </section>
        </div>
    );
}

function Fields({ fields, className }: { fields: Readonly<Record<string, ReactNode>>; className: string }) {
    return (
        <dl className={className}>
            {Object.entries(fields).map(([field, says]) => (
                <div key={field}>
                    <dt>
                        <code>{field}</code>
                    </dt>
                    <dd>{says}</dd>
                </div>
            ))}
        </dl>
    );
}

function CreateBotForm({ ref, onCreated }: { ref: Ref<HTMLInputElement>; onCreated: (created: Created) => void }) {
    const [name, setName] = useState(``);
    const [failure, setFailure] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const limited = useWait();

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
            const wait = limitedFor(cause);
            if (wait !== null) {
                limited.start(wait);
            } else if (cause instanceof ApiError) {
                setFailure(createErrorSentence(cause));
            } else {
                setFailure(text.build.failed);
            }
            setSending(false);
        }
    }

    const problem = liveProblem(name);
    const submittable = name !== `` && problem === null && !sending && limited.wait === null;

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
                    ref={ref}
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
            {limited.wait !== null ? (
                <p className="field-error" role="alert">
                    <WaitText wait={limited.wait} line={text.states.tooMany} />
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
