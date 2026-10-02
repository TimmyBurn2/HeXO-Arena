/**
 * The site's mark: a board cell framed in brass, holding a game's opening,
 * x's first stone above o's answering pair.
 * It wears the default look's board whatever the page wears, so the mark
 * stays one brand across every theme.
 */
export function Mark() {
    return (
        <svg className="brand-mark" data-theme-preview="ink" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            {/* drawn for this site rather than taken from an icon set, so it needs no credit */}
            <path className="brand-mark-cell" d="M16 .93L29.05 8.46V23.54L16 31.07L2.95 23.54V8.46Z" />
            <path className="brand-mark-x" d="M16 6.68L19.81 8.88V13.28L16 15.48L12.19 13.28V8.88Z" />
            <path
                className="brand-mark-o"
                d="M11.74 14.06L15.55 16.26V20.66L11.74 22.86L7.93 20.66V16.26ZM20.26 14.06L24.07 16.26V20.66L20.26 22.86L16.45 20.66V16.26Z"
            />
        </svg>
    );
}
