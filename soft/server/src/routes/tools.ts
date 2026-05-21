import { FastifyInstance } from 'fastify';
import { ToolLibrary } from '../cnc/ToolLibrary.js';

export default async function toolRoutes(server: FastifyInstance) {
    const library = new ToolLibrary();

    server.get('/api/tools', async (req, reply) => {
        return library.getAll();
    });

    server.post('/api/tools', async (req: any, reply) => {
        const tool = library.add(req.body);
        return tool;
    });

    server.put('/api/tools/:id', async (req: any, reply) => {
        const updated = library.update(req.params.id, req.body);
        if (updated) return updated;
        reply.code(404).send({ error: 'Tool not found' });
    });

    server.delete('/api/tools/:id', async (req: any, reply) => {
        const success = library.delete(req.params.id);
        if (success) return { status: 'deleted' };
        reply.code(404).send({ error: 'Tool not found' });
    });
}
