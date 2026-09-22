import type {Linter} from 'eslint'
import {makeEslintConfig} from 'eslint-config-jaid'

const config: Array<Linter.Config> = [
  ...makeEslintConfig(),
  {
    ignores: [
      'src/decoder/decode.ts',
      'src/decoder/dictionary.ts',
      'test/synthetic.test.ts',
    ],
  },
]

export default config
