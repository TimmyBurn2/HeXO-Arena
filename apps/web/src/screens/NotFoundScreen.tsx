import { Link } from '../router/Link';

export function NotFoundScreen() {
    return (
        <>
            <h1 className="screen-title">not found</h1>
            <p className="note">that page does not exist</p>
            <p>
                <Link to="/" className="btn btn-ghost">
                    Arena
                </Link>
            </p>
        </>
    );
}
