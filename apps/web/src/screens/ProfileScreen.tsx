import { discordLoginPath } from '@hexarena/contract';
import { BoardSettingsCard } from '../board/BoardSettingsCard';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { useDocumentMeta } from '../use-document-meta';

export function ProfileScreen() {
    const route = useRoute();
    useDocumentMeta(route);

    return (
        <>
            <h1 className="screen-title">Profile</h1>

            <h2 className="section-title">Identity</h2>
            <div className="card">
                <p className="note">discord is the only login; bots are created in Connect</p>
                <p className="card-actions">
                    <a className="btn btn-primary" href={discordLoginPath}>
                        Sign in with Discord
                    </a>
                    <Link to="/connect" className="btn btn-ghost">
                        Connect
                    </Link>
                </p>
            </div>

            <h2 className="section-title">Board rendering</h2>
            <BoardSettingsCard />
        </>
    );
}
