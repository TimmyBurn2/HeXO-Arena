import { lazy, Suspense, useEffect, useRef, useSyncExternalStore } from 'react';
import { SiteFooter } from './components/SiteFooter';
import { useFrameLent } from './frame';
import { Identity } from './identity/Identity';
import { Link } from './router/Link';
import { routePath, type Route } from './router/route';
import { useRoute } from './router/use-route';
import { Settings } from './settings/Settings';
import { siteStatusStore } from './site-status';
import { useDocumentMeta } from './use-document-meta';
import './AppShell.css';

const LadderScreen = lazy(async () => {
    const module = await import(`./screens/LadderScreen`);
    return { default: module.LadderScreen };
});
const BotsScreen = lazy(async () => {
    const module = await import(`./screens/BotsScreen`);
    return { default: module.BotsScreen };
});
const BotScreen = lazy(async () => {
    const module = await import(`./screens/BotScreen`);
    return { default: module.BotScreen };
});
const ConnectScreen = lazy(async () => {
    const module = await import(`./screens/ConnectScreen`);
    return { default: module.ConnectScreen };
});
const ProfileScreen = lazy(async () => {
    const module = await import(`./screens/ProfileScreen`);
    return { default: module.ProfileScreen };
});
const CreditsScreen = lazy(async () => {
    const module = await import(`./screens/CreditsScreen`);
    return { default: module.CreditsScreen };
});
const GameScreen = lazy(async () => {
    const module = await import(`./screens/GameScreen`);
    return { default: module.GameScreen };
});
const NotFoundScreen = lazy(async () => {
    const module = await import(`./screens/NotFoundScreen`);
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
    { route: { name: `ladder` }, label: `Ladder`, screens: [`ladder`], phoneTab: true },
    { route: { name: `bots` }, label: `Bots`, screens: [`bots`, `bot`], phoneTab: true },
    { route: { name: `connect` }, label: `Build a bot`, screens: [`connect`], phoneTab: true },
];

export function AppShell() {
    const route = useRoute();
    const paused = useSyncExternalStore(siteStatusStore.subscribe, siteStatusStore.read, siteStatusStore.read);
    const frameLent = useFrameLent();
    const mainRef = useRef<HTMLElement | null>(null);
    const firstRender = useRef(true);
    useDocumentMeta(route);

    useEffect(() => {
        siteStatusStore.start();
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
                    Skip to content
                </a>
            ) : null}
            {framed ? (
                <header className="topbar">
                    <div className="topbar-inner">
                        <Link to="/" className="brand">
                            hexarena
                        </Link>
                        <nav className="nav-links" aria-label="Main">
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
                    <div className="site-banner-inner">Starting games is paused; live games continue</div>
                </div>
            ) : null}
            <main className={framed ? `shell` : undefined} id="main" ref={mainRef} tabIndex={-1}>
                <Suspense fallback={framed ? <p className="note">Loading</p> : null}>
                    <RouteView route={route} />
                </Suspense>
            </main>
            {framed ? <SiteFooter /> : null}
            {framed ? (
                <nav className="tabbar" aria-label="Main">
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

type Layout = `framed` | `immersive`;

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
