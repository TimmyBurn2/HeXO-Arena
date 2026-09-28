/**
 * The site's mark: a plate cut at the cell's slope, with three stones and
 * their win line cut out of it, so the page shows through.
 * The sheet that places it picks its fill.
 */
export function Mark() {
    return (
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            {/* drawn for this site rather than taken from an icon set, so it needs no credit */}
            <path
                fillRule="evenodd"
                d="M9 0H23L32 5.2V26.8L23 32H9L0 26.8V5.2ZM22 .99l4 2.31v4.62l-4 2.31-4-2.31V3.3zM16 11.38l4 2.31v4.62l-4 2.31-4-2.31v-4.62zM10 21.77l4 2.31v4.62l-4 2.31-4-2.31v-4.62zM13.04 23.53L15.04 20.06L12.96 18.86L10.96 22.33ZM19.04 13.14L21.04 9.67L18.96 8.47L16.96 11.94ZM8.36 31.63L9.04 30.46L6.96 29.26L6.28 30.43ZM25.04 2.74L25.72 1.57L23.64 0.37L22.96 1.54Z"
            />
        </svg>
    );
}
