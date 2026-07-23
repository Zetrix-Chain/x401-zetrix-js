/** Shared test doubles for fetch-based Response mocks. */

export function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}
