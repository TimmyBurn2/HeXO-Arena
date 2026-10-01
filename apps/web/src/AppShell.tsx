import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { legalPagePath, signInFailureParam, signInFailureSchema, siteName, type SignInFailure } from '@hexo-arena/contract';
import { Mark } from './components/Mark';
import { SiteFooter } from './components/SiteFooter';
import { useFramed } from './frame';
import { Identity } from './identity/Identity';
import { Link } from './router/Link';
import { loadScreen, RouteBoundary } from './RouteBoundary';
import { routePath, type Route } from './router/route';
import { landingOf, subscribe, useRoute } from './router/use-route';
import { Settings } from './settings/Settings';
import { siteStatusStore } from './site-status';
import { text } from './text';
import { useDocumentMeta } from './use-document-meta';
import './AppShell.css';

const HomeScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/HomeScreen`));
    return { default: module.HomeScreen };
});
const PlayScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/PlayScreen`));
    return { default: module.PlayScreen };
});
const LadderScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/LadderScreen`));
    return { default: module.LadderScreen };
});
const TournamentsScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/TournamentsScreen`));
    return { default: module.TournamentsScreen };
});
const TournamentScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/TournamentScreen`));
    return { default: module.TournamentScreen };
});
const PlayerScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/PlayerScreen`));
    return { default: module.PlayerScreen };
});
const BotsScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/BotsScreen`));
    return { default: module.BotsScreen };
});
const BotScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/BotScreen`));
    return { default: module.BotScreen };
});
const GamesScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/GamesScreen`));
    return { default: module.GamesScreen };
});
const LiveGamesScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/LiveGamesScreen`));
    return { default: module.LiveGamesScreen };
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
const WelcomeScreen = lazy(async () => {
    const module = await loadScreen(async () => import(`./screens/WelcomeScreen`));
    return { default: module.WelcomeScreen };
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
    bar: boolean;
    phoneTab: boolean;
}

// The main nav as one table for the bar and the phone tabs: a new page
// adds a row, and its flags say where it shows. On the desktop the
// wordmark is the way home, so Home is a phone tab alone.
const nav: readonly NavEntry[] = [
    { route: { name: `home` }, label: text.shell.nav.home, screens: [`home`], bar: false, phoneTab: true },
    { route: { name: `play` }, label: text.shell.nav.play, screens: [`play`], bar: true, phoneTab: true },
    { route: { name: `games` }, label: text.shell.nav.games, screens: [`games`, `live-games`], bar: true, phoneTab: true },
    { route: { name: `ladder` }, label: text.shell.nav.ladder, screens: [`ladder`, `tournaments`, `tournament`], bar: true, phoneTab: true },
    { route: { name: `bots` }, label: text.shell.nav.bots, screens: [`bots`, `bot`], bar: true, phoneTab: true },
    { route: { name: `connect` }, label: text.shell.nav.build, screens: [`connect`], bar: true, phoneTab: false },
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
    // screen-reader users land on the new screen, not the top of the page,
    // unless the navigation asked the screen to focus a control of its own.
    useEffect(() => {
        if (firstRender.current) {
            firstRender.current = false;
            return;
        }
        if (landingOf() !== null) return;
        mainRef.current?.focus({ preventScroll: true });
    }, [route]);

    const framed = useFramed(route);

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
                            {nav
                                .filter((entry) => entry.bar)
                                .map((entry) => (
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
                        <p className="site-banner-inner">
                            {text.shell.signInFailed[signInFailure]((words) => <Link to={legalPagePath(`imprint`)}>{words}</Link>)}
                        </p>
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

function RouteView({ route }: { route: Route }) {
    switch (route.name) {
        case `home`:
            return <HomeScreen />;
        case `play`:
            return <PlayScreen />;
        case `ladder`:
            return <LadderScreen />;
        case `tournaments`:
            return <TournamentsScreen />;
        case `player`:
            return <PlayerScreen name={route.player} />;
        case `tournament`:
            return <TournamentScreen id={route.id} />;
        case `bots`:
            return <BotsScreen />;
        case `bot`:
            return <BotScreen name={route.bot} />;
        case `games`:
            return <GamesScreen />;
        case `live-games`:
            return <LiveGamesScreen />;
        case `connect`:
            return <ConnectScreen />;
        case `profile`:
            return <ProfileScreen />;
        case `credits`:
            return <CreditsScreen />;
        case `welcome`:
            return <WelcomeScreen />;
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
