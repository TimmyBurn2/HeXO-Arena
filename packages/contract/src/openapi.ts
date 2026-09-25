import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { apiVersion, healthzPath } from './index';

export function buildOpenApiDocument() {
    const registry = new OpenAPIRegistry();
    registry.registerPath({
        method: 'get',
        path: healthzPath,
        summary: 'Liveness probe.',
        // No response content: the probe carries zero information
        // (ADMIN.md section 3).
        responses: {
            200: { description: 'The process is up.' },
        },
    });
    const generator = new OpenApiGeneratorV3(registry.definitions);
    return generator.generateDocument({
        openapi: '3.0.3',
        info: { title: 'hexarena', version: apiVersion },
    });
}
