import { Link } from '../router/Link';

export function NotFoundScreen() {
    return (
        <>
            <h1 className="screen-title">Not found</h1>
            <p className="note">That page does not exist.</p>
            <p>
                <Link to="/" className="btn btn-ghost">
                    Arena
                </Link>
            </p>
        </>
    );
}
