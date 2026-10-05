import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { signInFailureParam, signInFailureSchema, siteName, type PageName, type SignInFailure } from '@hexo-arena/contract';
import { Mark } from './components/Mark';
import { SiteFooter } from './components/SiteFooter';
import { spansWindow, useFramed } from './frame';
import { Identity } from './identity/Identity';
import { useLegalSlots } from './legal/links';
import { Link } from './router/Link';
import { Moved } from './router/Moved';
import { loadScreen, RouteBoundary } from './RouteBoundary';
import { routePath, type PageRoute, type Route } from './router/route';
import { landingOf, subscribe, useRoute } from './router/use-route';
import { Settings } from './settings/Settings';
import { siteStatusStore, useSiteStatus } from './site-status';
import { text } from './text';
import { useDocumentMeta } from './use-document-meta';
import './AppShell.css';

// A screen's module, loaded on the first visit to its page.
function lazyScreen<Props extends object>(load: () => Promise<ComponentType<Props>>) {
    return lazy(async () => ({ default: await loadScreen(load) }));
}

const HomeScreen = lazyScreen(async () => (await import(`./screens/HomeScreen`)).HomeScreen);
const PlayScreen = lazyScreen(async () => (await import(`./screens/PlayScreen`)).PlayScreen);
const DuelsScreen = lazyScreen(async () => (await import(`./screens/DuelsScreen`)).DuelsScreen);
const PlayTournamentScreen = lazyScreen(async () => (await import(`./screens/PlayTournamentScreen`)).PlayTournamentScreen);
const GamesDuelsScreen = lazyScreen(async () => (await import(`./screens/GamesDuelsScreen`)).GamesDuelsScreen);
const DuelScreen = lazyScreen(async () => (await import(`./screens/DuelScreen`)).DuelScreen);
const LadderScreen = lazyScreen(async () => (await import(`./screens/LadderScreen`)).LadderScreen);
const TournamentsScreen = lazyScreen(async () => (await import(`./screens/TournamentsScreen`)).TournamentsScreen);
const TournamentScreen = lazyScreen(async () => (await import(`./screens/TournamentScreen`)).TournamentScreen);
const PlayerScreen = lazyScreen(async () => (await import(`./screens/PlayerScreen`)).PlayerScreen);
const BotsScreen = lazyScreen(async () => (await import(`./screens/BotsScreen`)).BotsScreen);
const BotScreen = lazyScreen(async () => (await import(`./screens/BotScreen`)).BotScreen);
const GamesScreen = lazyScreen(async () => (await import(`./screens/GamesScreen`)).GamesScreen);
const LiveGamesScreen = lazyScreen(async () => (await import(`./screens/LiveGamesScreen`)).LiveGamesScreen);
const AnalysisScreen = lazyScreen(async () => (await import(`./screens/AnalysisScreen`)).AnalysisScreen);
const ConnectScreen = lazyScreen(async () => (await import(`./screens/ConnectScreen`)).ConnectScreen);
const ProfileScreen = lazyScreen(async () => (await import(`./screens/ProfileScreen`)).ProfileScreen);
const CreditsScreen = lazyScreen(async () => (await import(`./screens/CreditsScreen`)).CreditsScreen);
const WelcomeScreen = lazyScreen(async () => (await import(`./screens/WelcomeScreen`)).WelcomeScreen);
const ReportScreen = lazyScreen(async () => (await import(`./screens/ReportScreen`)).ReportScreen);
const LegalScreen = lazyScreen(async () => (await import(`./screens/LegalScreen`)).LegalScreen);
const GameScreen = lazyScreen(async () => (await import(`./screens/GameScreen`)).GameScreen);
const NotFoundScreen = lazyScreen(async () => (await import(`./screens/NotFoundScreen`)).NotFoundScreen);

// The main nav's sections: each page names the one it stands under, if any.
type Section = `home` | `play` | `games` | `analysis` | `ladder` | `bots` | `build`;

// What the shell does with each page of the table: the screen it draws, and
// the nav section it lights; the type holds every page to one row.
const screens: { readonly [Name in PageName]: { readonly view: (route: PageRoute<Name>) => ReactNode; readonly section: Section | null } } = {
    home: { view: () => <HomeScreen />, section: `home` },
    play: { view: () => <PlayScreen />, section: `play` },
    'bot-duel': { view: () => <DuelsScreen />, section: `play` },
    'play-tournament': { view: () => <PlayTournamentScreen />, section: `play` },
    duel: { view: (route) => <DuelScreen id={route.id} />, section: `games` },
    ladder: { view: () => <LadderScreen />, section: `ladder` },
    tournament: { view: (route) => <TournamentScreen id={route.id} />, section: `games` },
    bots: { view: () => <BotsScreen />, section: `bots` },
    bot: { view: (route) => <BotScreen name={route.bot} />, section: `bots` },
    player: { view: (route) => <PlayerScreen name={route.player} />, section: null },
    games: { view: () => <GamesScreen />, section: `games` },
    'live-games': { view: () => <LiveGamesScreen />, section: `games` },
    'games-duels': { view: () => <GamesDuelsScreen />, section: `games` },
    'games-tournaments': { view: () => <TournamentsScreen />, section: `games` },
    analysis: { view: () => <AnalysisScreen />, section: `analysis` },
    connect: { view: () => <ConnectScreen />, section: `build` },
    profile: { view: () => <ProfileScreen />, section: null },
    credits: { view: () => <CreditsScreen />, section: null },
    welcome: { view: () => <WelcomeScreen />, section: null },
    report: { view: () => <ReportScreen />, section: null },
    legal: { view: (route) => <LegalScreen page={route.page} />, section: null },
    game: { view: (route) => <GameScreen gameId={route.gameId} />, section: null },
};

function viewOf<Name extends PageName>(name: Name, route: PageRoute<Name>): ReactNode {
    return screens[name].view(route);
}

interface NavEntry {
    section: Section;
    route: Route;
    label: string;
    bar: boolean;
    phoneTab: boolean;
}

// The main nav as one table for the bar and the phone tabs: its flags say
// where each section shows. On the desktop the wordmark is the way home,
// so Home is a phone tab alone.
const nav: readonly NavEntry[] = [
    { section: `home`, route: { name: `home` }, label: text.shell.nav.home, bar: false, phoneTab: true },
    { section: `play`, route: { name: `play` }, label: text.shell.nav.play, bar: true, phoneTab: true },
    { section: `games`, route: { name: `games` }, label: text.shell.nav.games, bar: true, phoneTab: true },
    { section: `analysis`, route: { name: `analysis` }, label: text.shell.nav.analysis, bar: true, phoneTab: true },
    { section: `ladder`, route: { name: `ladder` }, label: text.shell.nav.ladder, bar: true, phoneTab: true },
    { section: `bots`, route: { name: `bots` }, label: text.shell.nav.bots, bar: true, phoneTab: true },
    { section: `build`, route: { name: `connect` }, label: text.shell.nav.build, bar: true, phoneTab: false },
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
    const paused = useSiteStatus();
    const mainRef = useRef<HTMLElement | null>(null);
    const firstRender = useRef(true);
    const [signInFailure, setSignInFailure] = useState<SignInFailure | null>(null);
    const legal = useLegalSlots();
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
                            {text.shell.signInFailed[signInFailure](legal)}
                        </p>
                    </div>
                ) : null}
            </div>
            <main className={framed ? (spansWindow(route) ? `shell shell-wide` : `shell`) : undefined} id="main" ref={mainRef} tabIndex={-1}>
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
    if (route.name === `moved`) return <Moved to={`${route.to}${window.location.search}${window.location.hash}`} />;
    if (route.name === `not-found`) return <NotFoundScreen />;
    return viewOf(route.name, route);
}

function NavLink({ entry, route, className }: { entry: NavEntry; route: Route; className: string }) {
    const active = route.name !== `moved` && route.name !== `not-found` && screens[route.name].section === entry.section;
    return (
        <Link to={routePath(entry.route)} className={`${className}${active ? ` active` : ``}`} ariaCurrent={active}>
            {entry.label}
        </Link>
    );
}
