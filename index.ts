import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';
import { registerRoutes } from './src/routes';
import { PORT } from './src/config';

const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

registerRoutes(fastify)

fastify.listen({ port: PORT }, (err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is listening on port ${PORT}`);
});