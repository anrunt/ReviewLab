# Vendored anti-slop

- Source repository: https://github.com/dmmulroy/anti-slop
- Source commit: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Copied source directory: `skills/install-anti-slop/assets/anti-slop/`
- Installation directory: `tools/oxlint/anti-slop/`
- Generic plugin entry point: `index.ts`
- Optional Effect plugin entry point: `effect/index.ts`
- Compatible local dependencies: `oxlint` and `@oxlint/plugins`, both pinned to `1.82.0`.

## Copy and licenses

The bundled plugin was copied without source modifications using the installer from the recorded commit. Upstream test files were not copied; they are not part of the bundled assets.

The source repository's root MIT `LICENSE` was copied alongside the entry point. The nested `vendor/eslint-stylistic/LICENSE` and `vendor/eslint-stylistic/UPSTREAM.md` were preserved unchanged.

Local additions are this provenance document, the root `LICENSE`, and a private `package.json` declaring `"type": "module"`. The package metadata gives the vendored TypeScript plugin an explicit ES module scope without changing the application's module settings. No rule implementations or plugin exports have been changed.

## Configuration scope

The generic plugin is registered through `jsPlugins` in the root `.oxlintrc.json`. The vendored directory is excluded from lint targets with `tools/oxlint/anti-slop/**`; the plugin remains available to lint application code.

Only these seven user-selected generic rules are enabled, all at `error` severity:

- `anti-slop/no-chained-type-assertions`
- `anti-slop/no-widen-then-assert`
- `anti-slop/no-reduce-accumulator-copy`
- `anti-slop/no-object-parameters`
- `anti-slop/no-unknown-returns`
- `anti-slop/no-unknown-type-aliases`
- `anti-slop/require-readable-spacing`

`anti-slop/require-safety-comment-for-type-assertion` was initially selected but is explicitly set to `off` at the user's request. Do not re-enable it during updates.

Other rules, including the optional Effect plugin, were not selected. Do not automatically enable them during updates.

## Updating

Retrieve the exact recorded commit as the comparison baseline. Compare incoming changes with that baseline and the local copy before replacing files. Preserve local customizations, the selected rule policy, and all license notices. Update this document to identify the revision actually copied or merged.
