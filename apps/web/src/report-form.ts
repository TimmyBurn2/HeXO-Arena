import { reportFormMetaName } from '@hexo-arena/contract';

let on: boolean | null = null;

function readShell(): boolean {
    return typeof document !== `undefined` && document.querySelector(`meta[name="${reportFormMetaName}"]`)?.getAttribute(`content`) === `on`;
}

/**
 * Whether the deployment takes reports through the site's form, as the
 * shell the server sent says; a shell without the tag, such as the static
 * one the proxy serves while the app is down, leaves the form out.
 */
export const reportForm = {
    on(): boolean {
        on ??= readShell();
        return on;
    },
    /** Test seam: read the shell again, or take the setting given. */
    reset(value: boolean | null = null): void {
        on = value;
    },
};
