import { useEffect } from 'react';
import { routeMeta } from './route-meta';
import type { Route } from './router/route';

/**
 * Keep the document title and the embed tags in step with the route; the
 * server shell renders the same tags per route, so the two never disagree.
 * Detail screens pass the fetched headline; nothing else overrides.
 */
export function useDocumentMeta(route: Route, titleOverride?: string, descriptionOverride?: string): void {
    const base = routeMeta(route);
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
