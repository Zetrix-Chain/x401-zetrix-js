# Package structure

> Cross-references: §01 for the dependency graph, §04/§05 for the API surfaces.

## pnpm workspace layout

```
x401-zetrix-js/
├── docs/                          numbered guides + README index + superpowers/{specs,plans}
├── packages/
│   ├── server/                    npm: x401-zetrix-server   (Part A — RS verifier)
│   │   ├── src/
│   │   │   ├── config.ts          X401Config, defineConfig()
│   │   │   ├── model.ts           CredentialRequirements, VerificationData, ProofRequest,
│   │   │   │                      ProofResponse, ProofVerdict, VerifiedClaims
│   │   │   ├── client.ts          Oid4vpClient (built-in fetch)
│   │   │   ├── challenge.ts       buildProofChallenge()
│   │   │   ├── verify.ts          parseProofResponse(), verifyProofResponse(), hmacSign/hmacVerify
│   │   │   ├── errors.ts          X401Error, X401ErrorCode
│   │   │   ├── web/express.ts     requireProof() middleware   (express = optional peer dep)
│   │   │   ├── web/fastify.ts     x401Plugin                  (fastify = optional peer dep)
│   │   │   ├── web/generic.ts     handleChallenge()/handleVerify()
│   │   │   ├── index.ts           X401Verifier facade + re-exports
│   │   │   └── __tests__/         Vitest unit tests
│   │   └── package.json · tsconfig.json · vitest.config.ts · README.md
│   ├── client/                    npm: x401-zetrix-client   (Part B — wallet/holder)
│   │   ├── src/
│   │   │   ├── config.ts          X401WalletConfig, defineConfig()
│   │   │   ├── model.ts           ProofRequest, PresentationDefinition, Vp, ProofResponse, VerifiedResult
│   │   │   ├── signer.ts          HolderSigner + VcProofProvider (injected interfaces)
│   │   │   ├── oid4vp-client.ts   Oid4vpWalletClient: getPresentation(), submitPresentation()
│   │   │   ├── vp-builder.ts      buildVp() — delegates to a VcProofProvider
│   │   │   ├── proof-response.ts  parseProofRequest(), packageProofResponse()
│   │   │   ├── errors.ts          X401WalletError, X401WalletErrorCode
│   │   │   ├── index.ts           X401Wallet facade + re-exports
│   │   │   └── __tests__/         Vitest unit tests
│   │   └── package.json · tsconfig.json · vitest.config.ts · README.md
│   └── integration/               end-to-end tests vs a mock OID4VP (msw/nock)
│       ├── src/                   {resource-server.ts, wallet.ts, integration.test.ts}  (added later)
│       └── package.json · tsconfig.json · vitest.config.ts
├── package.json (private, workspace) · pnpm-workspace.yaml · tsconfig.base.json
├── .gitignore · README.md
```

`pnpm-workspace.yaml` globs `packages/*`, so both `server` and `client` are picked up
automatically.

## TypeScript config

- `tsconfig.base.json` (root) holds the shared compiler options: `target ES2020`,
  `module ESNext`, `moduleResolution bundler`, `strict`, `declaration` + `declarationMap`
  + `sourceMap`.
- Each package's `tsconfig.json` `extends` the base and sets only `outDir`/`rootDir`.
- Both `server` and `client` emit `.d.ts` type declarations and ship ESM
  (`"type": "module"`) with an `exports` map exposing `types` / `import` / `require` (CJS
  output is a build-tooling follow-up; the scaffold emits a single module format via `tsc`).

## Build & test commands

From the workspace root:

```bash
pnpm install          # install all workspace deps
pnpm build            # pnpm -r build  → tsc per package (emits packages/*/dist)
pnpm test             # pnpm -r test   → vitest run per package
pnpm test:coverage    # pnpm -r test:coverage → coverage with thresholds
```

Per package:

```bash
pnpm --filter x401-zetrix-server test:coverage
pnpm --filter x401-zetrix-client test:coverage
```

> The `integration` package has no `build` script (nothing to emit yet), so `pnpm -r build`
> only compiles `server` and `client`. Coverage thresholds are enforced per package — see
> §06 and CLAUDE.md.
