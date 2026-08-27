/**
 * Build config: reuses the repo's client-plugin preset (the same pipeline the
 * shipped @deepseek-ai/dsh-client-ui-* samples use). `pnpm run build` emits:
 *   - lib/index.js   — host half (ESM, node)
 *   - lib/client.js  — browser half (closure-factory bundle for
 *                      window.__ModuleLoader__.load, externals = platform modules)
 * Types land in lib/types via tsc.
 *
 * The preset import is build-time only; the published artifact is self-contained.
 */
import { clientBundle } from '../../deepseek-harness/packages/client/tsdown.client.ts'

export default clientBundle('dsh-hello-world', ['lib/types/index.js'])
