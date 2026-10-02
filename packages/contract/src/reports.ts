import { z } from 'zod';
import { controlOrBidiPattern } from './api';
import { pageTitle, siteName, type PageMeta } from './meta';

export const reportsPath = `/api/reports`;

/** Where the report form lives; the page it is opened from rides along as the subject. */
export const reportPagePath = `/report`;

/** The query parameter that carries the subject into the report form. */
export const reportSubjectParam = `subject`;

export const reportSubjectMaxLength = 512;
export const reportDetailsMaxLength = 2000;
export const reportNameMaxLength = 100;
export const reportEmailMaxLength = 254;

export const reportReasonSchema = z.enum([`illegal`, `abuse`, `name`, `cheating`, `other`]).meta({
    id: `ReportReason`,
    description: [
        `illegal: content against the law.`,
        `abuse: harassment, hate, or threats.`,
        `name: a name or text that is offensive, misleading, or impersonates someone.`,
        `cheating: unfair play, or one person behind several accounts.`,
        `other: anything else.`,
    ].join(` `),
});
export type ReportReason = z.infer<typeof reportReasonSchema>;

/** The reasons in the order the form offers them. */
export const reportReasons = reportReasonSchema.options;

// A path and its query in characters a URL carries unescaped, as a return
// path is written; the subject names a page of this site and nothing else.
const subjectPattern = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/;

/** The page a report is about: a path on this site with its query. */
export const reportSubjectSchema = z
    .string()
    .max(reportSubjectMaxLength)
    .regex(subjectPattern)
    .refine((path) => !path.includes(`//`), { message: `a subject never holds two slashes in a row` })
    .meta({ description: `The page the report is about: a path on this site, with its query.` });

// The operator reads reports in a terminal, where a control character can
// move the cursor or recolor the screen; a line break is all a report needs.
const readableText = (text: string) => !controlOrBidiPattern.test(text.replace(/\r?\n/gu, ``));

/**
 * A report as the form sends it.
 * Signed-out visitors may report, so the name and email are optional; the
 * good-faith statement is not.
 */
export const reportRequestSchema = z
    .strictObject({
        subject: reportSubjectSchema,
        reason: reportReasonSchema,
        details: z
            .string()
            .trim()
            .min(1)
            .max(reportDetailsMaxLength)
            .refine(readableText, { message: `control and bidirectional characters are refused` })
            .meta({ description: `What is wrong and why.` }),
        name: z.string().trim().min(1).max(reportNameMaxLength).refine(readableText, { message: `control and bidirectional characters are refused` }).optional(),
        email: z.string().trim().max(reportEmailMaxLength).regex(/^[^\s@]+@[^\s@]+$/).optional(),
        goodFaith: z.literal(true).meta({ description: `The reporter states that the report is accurate and made in good faith.` }),
    })
    .meta({ id: `ReportRequest` });
export type ReportRequest = z.infer<typeof reportRequestSchema>;

export const reportReceiptSchema = z
    .object({ id: z.number().int().min(1).meta({ description: `The report's number, for writing to the operator about it.` }) })
    .meta({ id: `ReportReceipt` });
export type ReportReceipt = z.infer<typeof reportReceiptSchema>;

/** The report form's meta. */
export const reportMeta: PageMeta = { title: pageTitle(`Report`), description: `Report a name, a bot, a game, or anything else on ${siteName} to the operator` };
