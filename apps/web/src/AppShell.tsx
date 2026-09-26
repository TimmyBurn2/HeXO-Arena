import { lazy, Suspense, useEffect, useRef, useSyncExternalStore } from 'react';
import { DiscordButton } from './components/DiscordButton';
import { useMe } from './me';
import { Link } from './router/Link';
import { routePath, type Route } from './router/route';
import { useRoute } from './router/use-route';
import { Settings } from './settings/Settings';
import { siteStatusStore } from './site-status';
import { useDocumentMeta } from './use-document-meta';
import './AppShell.css';

const ArenaScreen = lazy(async () => {
    const module = await import(`./screens/ArenaScreen`);
    return { default: module.ArenaScreen };
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

const navItems: readonly { route: Route; label: string; right?: boolean }[] = [
    { route: { name: `arena` }, label: `Arena` },
    { route: { name: `bots` }, label: `Bots` },
    { route: { name: `connect` }, label: `Connect` },
    { route: { name: `profile` }, label: `Profile`, right: true },
];

export function AppShell() {
    const route = useRoute();
    const paused = useSyncExternalStore(siteStatusStore.subscribe, siteStatusStore.read, siteStatusStore.read);
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

    // The game is immersive: the board is the screen, with no site chrome;
    // a paused banner would not apply, since live games continue.
    if (layoutOf(route) === `immersive`) {
        return (
            <main id="main" ref={mainRef} tabIndex={-1}>
                <Suspense fallback={null}>
                    <RouteView route={route} />
                </Suspense>
            </main>
        );
    }

    return (
        <>
            <a className="skip" href="#main">
                Skip to content
            </a>
            <header className="topbar">
                <div className="topbar-inner">
                    <Link to="/" className="brand">
                        hexarena
                    </Link>
                    <nav className="nav-links" aria-label="Main">
                        {navItems
                            .filter((item) => !item.right)
                            .map((item) => (
                                <NavLink key={item.label} item={item} route={route} />
                            ))}
                    </nav>
                    <div className="nav-right">
                        <Settings />
                        <Identity route={route} />
                    </div>
                </div>
            </header>
            {paused === `paused` ? (
                <div className="site-banner" role="status">
                    <div className="site-banner-inner">Starting games is paused; live games continue</div>
                </div>
            ) : null}
            <main className="shell" id="main" ref={mainRef} tabIndex={-1}>
                <Suspense fallback={<p className="note">Loading</p>}>
                    <RouteView route={route} />
                </Suspense>
            </main>
            <nav className="tabbar" aria-label="Main">
                {navItems.map((item) => (
                    <TabLink key={item.label} item={item} route={route} />
                ))}
            </nav>
        </>
    );
}

type Layout = `framed` | `immersive`;

function layoutOf(route: Route): Layout {
    return route.name === `game` ? `immersive` : `framed`;
}

function RouteView({ route }: { route: Route }) {
    switch (route.name) {
        case `arena`:
            return <ArenaScreen />;
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

// The top bar's right edge names who is here: a user's monogram and name,
// a guest's label marked unrated, or the way in.
function Identity({ route }: { route: Route }) {
    const state = useMe();
    const active = route.name === `profile`;
    if (state.status === `loading`) {
        return <span className="identity" aria-hidden="true" />;
    }
    const me = state.me;
    if (me === null) {
        return <DiscordButton />;
    }
    return (
        <Link to="/profile" className={`identity nav-link${active ? ` active` : ``}`} ariaCurrent={active}>
            <span className="monogram" aria-hidden="true">
                {me.kind === `user` ? me.name.slice(0, 1) : `g`}
            </span>
            <span className="identity-label">{me.name}</span>
            {me.kind === `guest` ? <span className="tag muted">unrated</span> : null}
        </Link>
    );
}

function navActive(route: Route, item: Route): boolean {
    if (item.name === `arena`) return route.name === `arena` || route.name === `game`;
    if (item.name === `bots`) return route.name === `bots` || route.name === `bot`;
    return route.name === item.name;
}

function NavLink({ item, route }: { item: { route: Route; label: string }; route: Route }) {
    const active = navActive(route, item.route);
    return (
        <Link to={routePath(item.route)} className={`nav-link${active ? ` active` : ``}`} ariaCurrent={active}>
            {item.label}
        </Link>
    );
}

function TabLink({ item, route }: { item: { route: Route; label: string }; route: Route }) {
    const active = navActive(route, item.route);
    return (
        <Link to={routePath(item.route)} className={`tab-link${active ? ` active` : ``}`} ariaCurrent={active}>
            {item.label}
        </Link>
    );
}
