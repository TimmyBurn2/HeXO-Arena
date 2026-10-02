import { LogController, type FastifyLoggerOptions, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';

/**
 * Which lines the app writes and where: nothing, or a level and a stream.
 * The line shape is not the caller's to choose, so tests read production lines.
 */
export type LogTarget = false | Pick<FastifyLoggerOptions, `level` | `stream`>;

// Paths carry player and bot names, and queries carry OAuth codes and engine tokens,
// so a request is logged by its route pattern alone.
// No line carries an address: the visitor's is personal data,
// and the peer's is only ever the proxy's, since trustProxy stays off.
const serializers = {
    req: (request: FastifyRequest) => ({ method: request.method, route: request.routeOptions.url ?? null }),
};

/** Logs a client error by its code and status alone: its message may quote what the client sent. */
export function logClientError(error: unknown, reply: FastifyReply): void {
    const fields = typeof error === `object` && error !== null ? error : {};
    const code = `code` in fields ? fields.code : undefined;
    const statusCode = `statusCode` in fields ? fields.statusCode : undefined;
    reply.log.info({ res: reply, err: { code, statusCode } }, `client error`);
}

class RouteLogController extends LogController {
    // Server errors keep message and stack, which are the server's own.
    override defaultErrorLog(error: Error, request: FastifyRequest, reply: FastifyReply): void {
        if (reply.statusCode >= 500) {
            super.defaultErrorLog(error, request, reply);
            return;
        }
        if (this.isLogDisabled(request)) return;
        logClientError(error, reply);
    }
}

/**
 * Fastify's logging options for a target; every target gets the one line shape.
 */
export function loggingOptions(target: LogTarget = {}): Pick<FastifyServerOptions, `logger` | `logController`> {
    return {
        logger: target === false ? false : { ...target, serializers },
        logController: new RouteLogController(),
    };
}
