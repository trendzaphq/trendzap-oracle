/**
 * Shared-secret authentication for the oracle's write endpoints.
 *
 * ORACLE_API_KEY was already being passed into the container by docker-compose.yml,
 * but nothing in the service ever read it — every endpoint, including /schedule, was
 * open. Fails CLOSED: an unconfigured key denies the request rather than allowing it.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';
import { logger } from '../utils/logger';

/** Length-independent constant-time-ish comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Fastify preHandler. Accepts the key as either `x-api-key` or `Authorization: Bearer`.
 */
export async function requireApiKey(request: FastifyRequest, reply: FastifyReply) {
  const expected = config.apiKey;

  if (!expected) {
    logger.error('ORACLE_API_KEY is not configured — refusing privileged request');
    return reply.code(503).send({ error: 'Service is not configured for authenticated requests' });
  }

  const headerKey = request.headers['x-api-key'];
  const bearer = request.headers.authorization;
  const provided =
    (typeof headerKey === 'string' ? headerKey : undefined) ??
    (bearer?.startsWith('Bearer ') ? bearer.slice('Bearer '.length) : undefined);

  if (!provided || !timingSafeEqual(provided, expected)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}
