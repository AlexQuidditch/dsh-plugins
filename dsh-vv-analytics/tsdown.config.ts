/**
 * Build config: reuses the repo's client-plugin preset (the same pipeline the
 * shipped @deepseek-ai/dsh-client-ui-* samples use). `pnpm run build` emits:
 *   - lib/index.js   — host half (ESM, node)
 *   - lib/client.js  — browser half (closure-factory bundle)
 * Types land in lib/types via tsc.
 */
import { clientBundle } from '../../deepseek-harness/packages/client/tsdown.client.ts'

export default clientBundle('dsh-vv-analytics', ['lib/types/index.js'])
