/**
 * Fastify adapter — `x401Plugin`.
 *
 * `fastify` is an OPTIONAL peer dependency, so this adapter uses a minimal structural
 * plugin signature instead of importing Fastify types (keeps the SDK compiling without it).
 *
 * Registers an `onRequest` hook that gates every route in its scope: no `PROOF-RESPONSE`
 * → 401 + `PROOF-REQUEST`; present → verify → allow (claims on `request.x401Claims`) or
 * 403 + error. Session binding follows the same self-bind default as the Express adapter
 * (pass `resolveExpectedRequestId` for true cross-request binding).
 */

import type { CredentialRequirements } from "../model.js";
import type { X401Verifier } from "../index.js";
import { handleChallenge, handleVerify, selfBoundRequestId } from "./generic.js";
import { renderProofResult } from "../result.js";

interface FastifyRequestLike {
  headers: Record<string, string | string[] | undefined>;
  [key: string]: unknown;
}

interface FastifyReplyLike {
  code(statusCode: number): FastifyReplyLike;
  header(field: string, value: string): FastifyReplyLike;
  send(payload: unknown): FastifyReplyLike;
}

interface FastifyInstanceLike {
  addHook(
    name: "onRequest",
    // Returns `Promise<unknown>`: an async hook that replies MUST return the reply
    // to halt Fastify's request lifecycle; returning undefined lets it continue.
    hook: (request: FastifyRequestLike, reply: FastifyReplyLike) => Promise<unknown>,
  ): void;
}

export interface X401PluginOptions {
  verifier: X401Verifier;
  requirements: CredentialRequirements;
  /**
   * Return the `request_id` the resource server issued for this session, for
   * cross-request session binding. If omitted, the hook self-binds to the
   * `presentationId` carried in the `PROOF-RESPONSE`.
   */
  resolveExpectedRequestId?: (request: FastifyRequestLike) => string | undefined;
}

/** Loose Fastify-plugin shape: `(instance, opts) => Promise<void>`. */
export type FastifyPluginAsyncLike<Opts> = (
  instance: unknown,
  opts: Opts,
) => Promise<void>;

/** Fastify plugin that gates routes behind an x401 identity proof. */
export const x401Plugin: FastifyPluginAsyncLike<X401PluginOptions> = async (
  instance,
  opts,
) => {
  const { verifier, requirements, resolveExpectedRequestId } = opts;
  const app = instance as FastifyInstanceLike;

  app.addHook("onRequest", async (request, reply) => {
    const header = verifier.readProofResponse(request.headers);

    if (header === undefined) {
      const http401 = await handleChallenge(verifier, requirements);
      reply.code(http401.status);
      for (const [name, value] of Object.entries(http401.headers)) {
        reply.header(name, value);
      }
      // `return reply` so Fastify stops the lifecycle after we've responded.
      return reply.send(http401.body);
    }

    const expectedRequestId =
      resolveExpectedRequestId?.(request) ?? selfBoundRequestId(header);
    const verdict = handleVerify(verifier, header, expectedRequestId);

    if (verdict.allowed) {
      request.x401Claims = verdict.claims;
      return undefined;
    }

    return reply.code(403).send(renderProofResult(verdict));
  });
};
