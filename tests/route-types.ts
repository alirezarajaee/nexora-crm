/** Minimal structural type for exported Next.js route handlers.
 * ctx is `any` because Next.js generates per-route param types; tests pass
 * a generic { params: Promise<Record<string,string>> } context. */
export type Handler = (req: Request, ctx: any) => Promise<Response>;
