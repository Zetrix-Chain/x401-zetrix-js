/**
 * ESM publish guard.
 *
 * The unit suites run under vitest/tsx, which use bundler-style resolution and therefore
 * accept extensionless relative imports. Native Node ESM does NOT — a published, ESM-only
 * package with extensionless imports throws ERR_MODULE_NOT_FOUND on `import`. That failure
 * is invisible to every in-process test.
 *
 * This test spawns a real `node` process to `import()` each built package the way a consumer
 * would, asserting the module actually loads. It exercises the compiled `dist` output (via
 * the workspace symlink → each package's `exports` → dist/index.js), so if any relative
 * import ever loses its `.js` extension again, this fails.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** Import `specifier` in a fresh Node ESM process; return the printed probe or throw on load failure. */
function importUnderNode(specifier: string, probe: string): string {
  const src = `import(${JSON.stringify(specifier)}).then((m) => { process.stdout.write(String(${probe})); });`;
  return execFileSync(process.execPath, ["--input-type=module", "-e", src], {
    cwd: __dirname,
    encoding: "utf8",
  }).trim();
}

describe("ESM publish guard — packages import under native Node", () => {
  it("x401-zetrix-server loads and exposes X401Verifier + ZETRIX_OID4VP_URLS", () => {
    const out = importUnderNode(
      "x401-zetrix-server",
      'typeof m.X401Verifier + "," + typeof m.ZETRIX_OID4VP_URLS',
    );
    expect(out).toBe("function,object");
  });

  it("x401-zetrix-client loads and exposes X401Wallet", () => {
    const out = importUnderNode("x401-zetrix-client", "typeof m.X401Wallet");
    expect(out).toBe("function");
  });
});
