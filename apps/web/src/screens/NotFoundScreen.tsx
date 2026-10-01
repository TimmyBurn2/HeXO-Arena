import { Link } from '../router/Link';
import { text } from '../text';

/** A page that is not there, with the way back to the ladder. */
export function NotFoundScreen({
    heading = text.states.notFoundHeading,
    sentence = text.states.notFoundSentence,
}: {
    heading?: string;
    sentence?: string;
}) {
    return (
        <>
            <h1 className="screen-title">{heading}</h1>
            <p className="note">{sentence}</p>
            <p>
                <Link to="/" className="btn btn-ghost">
                    {text.states.notFoundHome}
                </Link>
            </p>
        </>
    );
}
