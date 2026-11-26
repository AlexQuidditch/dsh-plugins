# @alexquidditch/dsh-spec-guard

The GRACE markup engine extracted from the DSH `spec_guard_*` tools. One implementation,
three consumers:

- **core** — `auditGraceFile(path, text)` parses GRACE declarations, pairs markers, and
  reports `unpaired-marker`, `complexity-missing`, `complexity-blocks`, `module-map-*`,
  `use-case-shape`, and `invariant-multi-rule`.
- **ESLint plugin** (`@alexquidditch/dsh-spec-guard/eslint`) — per-file editor squiggles and
  lint errors; no baseline, structural rules only.
- **CLI** (`dsh-spec-guard grace audit`) — repo-wide audit, `--fail-on` policy, optional
  baseline ratchet, JSON output.

## CLI

```bash
dsh-spec-guard grace audit --repo-root . \
  --scope packages --scope eslint.config.ts \
  --fail-on unpaired-marker,complexity-blocks,complexity-missing
```

Options:

- `--repo-root <dir>` (default: cwd)
- `--scope <path>` repeatable; a directory is walked recursively for `.ts/.tsx/.vue`,
  a file is audited directly
- `--exclude <name>` repeatable directory names to skip (defaults: `node_modules`, `dist`,
  `.git`, `.turbo`, `.tmp-e2e`, `prototypes`)
- `--fail-on <rules>` comma-separated; default: `unpaired-marker,complexity-blocks,complexity-missing`
- `--baseline <file>` apply the v2 baseline ratchet; regressions fail, accepted debt is reported
- `--accept` write the current findings to `--baseline` (explicit debt acceptance; never run in CI)
- `--json` machine-readable output
- `--version`, `--help`

Exit codes: `0` pass, `1` failing findings/regressions, `2` usage or I/O error.

## ESLint plugin

```js
import grace from '@alexquidditch/dsh-spec-guard/eslint'

export default [{
  files: ['**/*.{ts,tsx,vue}'],
  plugins: { '@alexquidditch/dsh-spec-guard': grace },
  rules: {
    '@alexquidditch/dsh-spec-guard/unpaired-marker': 'error',
    '@alexquidditch/dsh-spec-guard/complexity-blocks': 'error',
    '@alexquidditch/dsh-spec-guard/complexity-missing': 'error',
  },
}]
```

The plugin never reimplements a rule: each rule runs `auditGraceFile` once per ESLint
`SourceCode` (WeakMap cache) and reports the engine's findings with `displayLine`.
`use-case-shape` / `invariant-multi-rule` are deliberately not exposed: they are prose
advisories and are better handled by the CLI report/baseline.

## Publishing

GitHub Packages requires the package name to be scoped to the repository owner:
`@alexquidditch/dsh-spec-guard`. Publish with a token that has `write:packages` (and
`read:packages` for consumers):

```bash
pnpm build
pnpm publish --registry https://npm.pkg.github.com
```

Consumers add:

```ini
@alexquidditch:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```
