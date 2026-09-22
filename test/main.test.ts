import {expect, test} from 'bun:test'

const {default: decodeBrotli} = await import('#src/main.ts')

test('should run', () => {
  const result = decodeBrotli()
  expect(result).toBe('decode-brotli') // TODO Test actual functionality
})
