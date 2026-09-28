import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { signInFailureParam, signInFailureSchema, siteName, type SignInFailure } from '@hexo-arena/contract';
import { Mark } from './components/Mark';
import { SiteFooter } from './components/SiteFooter';
import { useFrameLent, type Layout } from './frame';
import { Identity } from './identity/Identity';
import { Link } from './router/Link';
import { loadScreen, RouteBoundary } from './RouteBoundary';
import { routePath, type Route } from './router/route';
import { subscribe, useRoute } from './router/use-route';
import { Settings } from './settings/Settings';
import { siteStatusStore } from './site-status';
import { text } from './text';
import { useDocumentMeta } from './use-document-meta';
import './AppShell.css';

const LadderScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/LadderScreen`));
    return { default: module.LadderScreen };
});
const BotsScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/BotsScreen`));
    return { default: module.BotsScreen };
});
const BotScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/BotScreen`));
    return { default: module.BotScreen };
});
const ConnectScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/ConnectScreen`));
    return { default: module.ConnectScreen };
});
const ProfileScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/ProfileScreen`));
    return { default: module.ProfileScreen };
});
const CreditsScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/CreditsScreen`));
    return { default: module.CreditsScreen };
});
const LegalScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/LegalScreen`));
    return { default: module.LegalScreen };
});
const GameScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/GameScreen`));
    return { default: module.GameScreen };
});
const NotFoundScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/NotFoundScreen`));
    return { default: module.NotFoundScreen };
});

interface NavEntry {
    route: Route;
    label: string;
    // The screens the entry stands for: its own and those under it.
    screens: readonly Route[`name`][];
    phoneTab: boolean;
}

// The main nav as one table for the bar and the phone tabs: a new page
// adds a row, and its flag says whether it takes a phone tab too.
const nav: readonly NavEntry[] = [
    { route: { name: `ladder` }, label: text.shell.nav.ladder, screens: [`ladder`], phoneTab: true },
    { route: { name: `bots` }, label: text.shell.nav.bots, screens: [`bots`, `bot`], phoneTab: true },
    { route: { name: `connect` }, label: text.shell.nav.build, screens: [`connect`], phoneTab: true },
];

// The reason a sign-in failed, as the server's redirect names it; any
// other value is ignored.
function signInFailureOf(search: string): SignInFailure | null {
    const parsed = signInFailureSchema.safeParse(new URLSearchParams(search).get(signInFailureParam));
    return parsed.success ? parsed.data : null;
}

// The reason is said once, so a reload or a copied address never repeats it.
function dropSignInFailure(): void {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(signInFailureParam)) return;
    url.searchParams.delete(signInFailureParam);
    window.history.replaceState(window.history.state, ``, `${url.pathname}${url.search}${url.hash}`);
}

export function AppShell() {
    const route = useRoute();
    const paused = useSyncExternalStore(siteStatusStore.subscribe, siteStatusStore.read, siteStatusStore.read);
    const frameLent = useFrameLent();
    const mainRef = useRef<HTMLElement | null>(null);
    const firstRender = useRef(true);
    const [signInFailure, setSignInFailure] = useState<SignInFailure | null>(null);
    useDocumentMeta(route);

    useEffect(() => {
        siteStatusStore.start();
    }, []);

    // The failure's line lands in a live region that is already on the page,
    // so a screen reader announces it, and stays until the visitor goes
    // elsewhere.
    useEffect(() => {
        const failure = signInFailureOf(window.location.search);
        if (failure !== null) setSignInFailure(failure);
        dropSignInFailure();
        return subscribe(() => {
            setSignInFailure(null);
        });
    }, []);

    // Route changes move focus to the content, so keyboard and
    // screen-reader users land on the new screen, not the top of the page.
    useEffect(() => {
        if (firstRender.current) {
            firstRender.current = false;
            return;
        }
        mainRef.current?.focus({ preventScroll: true });
    }, [route]);

    const framed = layoutOf(route) === `framed` || frameLent;

    // The main landmark keeps its place whichever layout wraps it, so a
    // screen that asks for the frame keeps its state.
    return (
        <>
            {framed ? (
                <a className="skip" href="#main">
                    {text.shell.skipToContent}
                </a>
            ) : null}
            {framed ? (
                <header className="topbar">
                    <div className="topbar-inner">
                        <Link to="/" className="brand">
                            <Mark />
                            {siteName}
                        </Link>
                        <nav className="nav-links" aria-label={text.shell.mainNav}>
                            {nav.map((entry) => (
                                <NavLink key={entry.label} entry={entry} route={route} className="nav-link" />
                            ))}
                        </nav>
                        <div className="nav-right">
                            <Settings />
                            <Identity route={route} />
                        </div>
                    </div>
                </header>
            ) : null}
            {framed && paused === `paused` ? (
                <div className="site-banner" role="status">
                    <div className="site-banner-inner">{text.shell.paused}</div>
                </div>
            ) : null}
            <div role="status">
                {framed && signInFailure !== null ? (
                    <div className="site-banner">
                        <div className="site-banner-inner">{text.shell.signInFailed[signInFailure]}</div>
                    </div>
                ) : null}
            </div>
            <main className={framed ? `shell` : undefined} id="main" ref={mainRef} tabIndex={-1}>
                <RouteBoundary layout={framed ? `framed` : `immersive`} resetKey={routePath(route)}>
                    <Suspense fallback={framed ? <p className="note">{text.states.loading}</p> : null}>
                        <RouteView route={route} />
                    </Suspense>
                </RouteBoundary>
            </main>
            {framed ? <SiteFooter /> : null}
            {framed ? (
                <nav className="tabbar" aria-label={text.shell.mainNav}>
                    {nav
                        .filter((entry) => entry.phoneTab)
                        .map((entry) => (
                            <NavLink key={entry.label} entry={entry} route={route} className="tab-link" />
                        ))}
                </nav>
            ) : null}
        </>
    );
}

// The game is immersive: the board is the screen, with no site chrome; a
// paused banner would not apply, since live games continue.
function layoutOf(route: Route): Layout {
    return route.name === `game` ? `immersive` : `framed`;
}

function RouteView({ route }: { route: Route }) {
    switch (route.name) {
        case `ladder`:
            return <LadderScreen />;
        case `bots`:
            return <BotsScreen />;
        case `bot`:
            return <BotScreen name={route.bot} />;
        case `connect`:
            return <ConnectScreen />;
        case `profile`:
            return <ProfileScreen />;
        case `credits`:
            return <CreditsScreen />;
        case `legal`:
            return <LegalScreen page={route.page} />;
        case `game`:
            return <GameScreen gameId={route.gameId} />;
        case `not-found`:
            return <NotFoundScreen />;
    }
}

function NavLink({ entry, route, className }: { entry: NavEntry; route: Route; className: string }) {
    const active = entry.screens.includes(route.name);
    return (
        <Link to={routePath(entry.route)} className={`${className}${active ? ` active` : ``}`} ariaCurrent={active}>
            {entry.label}
        </Link>
    );
}
