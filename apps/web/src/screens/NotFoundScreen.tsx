import { Link } from '../router/Link';

/** A page that is not there, with the way back to the ladder. */
export function NotFoundScreen({ heading = `Not found`, sentence = `That page does not exist.` }: { heading?: string; sentence?: string }) {
    return (
        <>
            <h1 className="screen-title">{heading}</h1>
            <p className="note">{sentence}</p>
            <p>
                <Link to="/ladder" className="btn btn-ghost">
                    Ladder
                </Link>
            </p>
        </>
    );
}
