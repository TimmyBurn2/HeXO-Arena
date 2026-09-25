import { healthzPath } from '@hexarena/contract';
import Fastify, { type FastifyInstance } from 'fastify';

export function buildApp(): FastifyInstance {
    const app = Fastify({ logger: true });
    app.get(healthzPath, async (_request, reply) => {
        // Liveness only: no db probe, no version, no uptime (ADMIN.md
        // section 3), so the endpoint leaks nothing.
        reply.code(200).send();
    });
    return app;
}
