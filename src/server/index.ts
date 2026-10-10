import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { registerRoutes, type AppContainer } from './routes.js';
import { registerWsRoutes } from './ws.js';

export async function createServer(container: AppContainer) {
  const app = Fastify({
    logger: false,
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(fastifyWebsocket);

  await app.register(registerRoutes, { container });
  registerWsRoutes(app, container.dataService);

  // Dashboard static assets are mounted in Phase 3.
  return app;
}