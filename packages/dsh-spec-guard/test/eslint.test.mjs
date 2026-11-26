// RuleTester coverage for the GRACE ESLint adapter. Run: pnpm test
import { RuleTester } from 'eslint'
import plugin from '../lib/eslint.js'

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
})

const moduleContract = [
  '// START_MODULE_CONTRACT:',
  '//   PURPOSE: demo',
  '// END_MODULE_CONTRACT',
  'const x = 1',
].join('\n')

tester.run('unpaired-marker', plugin.rules['unpaired-marker'], {
  valid: [
    { code: `${moduleContract}\n// START_BLOCK_A\n// END_BLOCK_A` },
    { code: 'const plain = 1' },
  ],
  invalid: [
    {
      code: `${moduleContract}\n// START_BLOCK_A\nconst y = 2`,
      errors: [{ message: /has no matching END/ }],
    },
  ],
})

tester.run('complexity-missing', plugin.rules['complexity-missing'], {
  valid: [
    {
      code: [
        '// START_MODULE_CONTRACT:',
        '//   PURPOSE: demo',
        '// END_MODULE_CONTRACT',
        '// START_FUNCTION_heavy',
        '// START_CONTRACT: heavy',
        '//   COMPLEXITY_SCORE: 1',
        '// END_CONTRACT: heavy',
        'function heavy() {}',
        '// END_FUNCTION_heavy',
      ].join('\n'),
    },
  ],
  invalid: [
    {
      code: [
        '// START_MODULE_CONTRACT:',
        '//   PURPOSE: demo',
        '// END_MODULE_CONTRACT',
        '// START_FUNCTION_heavy',
        '// START_CONTRACT: heavy',
        '//   PURPOSE: no score',
        '// END_CONTRACT: heavy',
        'function heavy() {}',
        '// END_FUNCTION_heavy',
      ].join('\n'),
      errors: [{ message: /has no COMPLEXITY_SCORE/ }],
    },
  ],
})

tester.run('complexity-blocks', plugin.rules['complexity-blocks'], {
  valid: [
    {
      code: [
        '// START_MODULE_CONTRACT:',
        '//   PURPOSE: demo',
        '// END_MODULE_CONTRACT',
        '// START_FUNCTION_heavy',
        '// START_CONTRACT: heavy',
        '//   COMPLEXITY_SCORE: 9',
        '// END_CONTRACT: heavy',
        'function heavy() {',
        '  // START_BLOCK_BODY',
        '  return 1',
        '  // END_BLOCK_BODY',
        '}',
        '// END_FUNCTION_heavy',
      ].join('\n'),
    },
  ],
  invalid: [
    {
      code: [
        '// START_MODULE_CONTRACT:',
        '//   PURPOSE: demo',
        '// END_MODULE_CONTRACT',
        '// START_FUNCTION_heavy',
        '// START_CONTRACT: heavy',
        '//   COMPLEXITY_SCORE: 9',
        '// END_CONTRACT: heavy',
        'function heavy() {',
        '  return 1',
        '}',
        '// END_FUNCTION_heavy',
      ].join('\n'),
      errors: [{ message: /no START_BLOCK markers/ }],
    },
  ],
})

console.log('eslint plugin tests passed')
