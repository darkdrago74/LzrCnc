import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { MaterialService } from '../services/MaterialService.js';

interface RouteOptions {
    materialService: MaterialService;
}

const materialRoutes: FastifyPluginAsync<RouteOptions> = async (fastify, options) => {
    const { materialService } = options;

    fastify.get('/materials', async (request, reply) => {
        return materialService.getAll();
    });

    fastify.post('/materials', async (request, reply) => {
        const material = request.body as any;
        if (material.id) {
            await materialService.update(material.id, material);
        } else {
            await materialService.add(material);
        }
        return { status: 'success' };
    });

    fastify.delete('/materials/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        await materialService.delete(id);
        return { status: 'success' };
    });
};

export default materialRoutes;
