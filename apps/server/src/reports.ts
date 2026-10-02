import {
    adminOpenReportsShown,
    reportReasonSchema,
    reportRequestSchema,
    reportsPath,
    type AdminReport,
    type ReportReceipt,
    type ReportRequest,
} from '@hexo-arena/contract';
import { and, asc, count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { nowSeconds, type Query } from './db';
import { reports } from './db/schema';
import { refuseRate, type ClientLimits } from './request-limits';

export function insertReport(query: Query, report: ReportRequest): number {
    const [row] = query
        .insert(reports)
        .values({
            subject: report.subject,
            reason: report.reason,
            details: report.details,
            reporterName: report.name ?? null,
            reporterEmail: report.email ?? null,
            goodFaith: 1,
            createdAt: nowSeconds(),
        })
        .returning({ id: reports.id })
        .all();
    if (row === undefined) throw new Error(`a report insert returned no row`);
    return row.id;
}

/** The open reports, oldest first, as many as the status shows, and how many are open in all. */
export function openReports(query: Query): { count: number; oldest: AdminReport[] } {
    const open = eq(reports.status, `open`);
    const total = query.select({ n: count() }).from(reports).where(open).get()?.n ?? 0;
    const oldest = query
        .select({
            id: reports.id,
            subject: reports.subject,
            reason: reports.reason,
            details: reports.details,
            name: reports.reporterName,
            email: reports.reporterEmail,
            at: reports.createdAt,
        })
        .from(reports)
        .where(open)
        .orderBy(asc(reports.createdAt), asc(reports.id))
        .limit(adminOpenReportsShown)
        .all()
        // The reason check admits only the contract's reasons.
        .map((row) => ({ ...row, reason: reportReasonSchema.parse(row.reason) }));
    return { count: total, oldest };
}

export type ReportClose = { kind: `closed` } | { kind: `already_closed` } | { kind: `not_found` };

/** Closes an open report with the operator's note, which it keeps. */
export function closeReport(query: Query, id: number, note: string): ReportClose {
    const closed = query
        .update(reports)
        .set({ status: `closed`, closedAt: nowSeconds(), note })
        .where(and(eq(reports.id, id), eq(reports.status, `open`)))
        .run().changes;
    if (closed === 1) return { kind: `closed` };
    return query.select({ id: reports.id }).from(reports).where(eq(reports.id, id)).get() === undefined ? { kind: `not_found` } : { kind: `already_closed` };
}

/**
 * The report form's endpoint: anyone may send one, held to its own
 * limits per client, per IPv6 /48, and across every caller, and stored
 * for the operator alone; nothing leaves the server.
 */
export function registerReportApi(app: FastifyInstance, deps: { query: Query; limits: ClientLimits }): void {
    app.post(reportsPath, { config: { limit: `public` } }, async (request, reply) => {
        const wait = deps.limits.wait(`report`, request) ?? deps.limits.takeReport();
        if (wait !== null) return refuseRate(reply, wait);
        const parsed = reportRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: `the report fails validation`, code: `bad_request` });
        const receipt: ReportReceipt = { id: insertReport(deps.query, parsed.data) };
        return reply.code(201).send(receipt);
    });
}
