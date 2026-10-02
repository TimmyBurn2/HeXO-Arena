import type { AdminAction, AdminMutation } from '@hexo-arena/contract';
import { desc } from 'drizzle-orm';
import { nowSeconds, type Query } from './db';
import { adminActions } from './db/schema';

export function recordAdminAction(
    query: Query,
    action: { actor: string; action: AdminMutation[`op`]; target: string | null; reason: string },
): void {
    query.insert(adminActions).values({ ...action, at: nowSeconds() }).run();
}

export function recentAdminActions(query: Query, limit: number): AdminAction[] {
    return query
        .select({
            actor: adminActions.actor,
            action: adminActions.action,
            target: adminActions.target,
            reason: adminActions.reason,
            at: adminActions.at,
        })
        .from(adminActions)
        .orderBy(desc(adminActions.id))
        .limit(limit)
        .all();
}
