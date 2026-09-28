import { useEffect } from 'react';
import { rootMeta, routeMeta } from './route-meta';
import type { Route } from './router/route';
import { usePath } from './router/use-route';

/**
 * Keep the document title and the embed tags in step with the route, under
 * the titles the server shell renders for the same paths.
 * Detail screens pass the fetched headline; nothing else overrides.
 */
export function useDocumentMeta(route: Route, titleOverride?: string, descriptionOverride?: string): void {
    const base = usePath() === `/` ? rootMeta : routeMeta(route);
    const title = titleOverride ?? base.title;
    const description = descriptionOverride ?? base.description;

    useEffect(() => {
        document.title = title;
        setMetaContent(`property`, `og:title`, title);
        setMetaContent(`property`, `og:description`, description);
        setMetaContent(`name`, `description`, description);
    }, [title, description]);
}

function setMetaContent(kind: string, key: string, content: string): void {
    let tag = document.querySelector(`meta[${kind}="${key}"]`);
    if (tag === null) {
        tag = document.createElement(`meta`);
        tag.setAttribute(kind, key);
        document.head.append(tag);
    }
    tag.setAttribute(`content`, content);
}
