// `express` is an optional peer dep, not part of this SDK's API — shim its surface as `any`
// for the examples type-check so we catch drift in the x401-zetrix-server API without
// vendoring express or its @types.
declare module "express" {
  export type Request = any;
  export type Response = any;
  export type NextFunction = any;
  export type RequestHandler = any;
  const express: any;
  export default express;
}
