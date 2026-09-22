import {describe, expect, test} from 'bun:test'
import {createHash} from 'node:crypto'

import {data, offsets, sizeBits} from '../src/decoder/dictionary.ts'
import decodeBrotli from '../src/main.ts'
import manifest from './fixtures/manifest.json'
import {concat, expectError} from './helpers.ts'

// Outputs were verified against the upstream CRC-64 names before recording SHA-256.
describe('upstream interoperability corpus', () => {
  for (const entry of manifest) {
    test(entry.file, async () => {
      const input = await Bun.file(new URL(`./fixtures/upstream/${entry.file}`, import.meta.url)).bytes()
      const output = decodeBrotli(input)
      expect(output.length).toBe(entry.bytes)
      expect(createHash('sha256').update(output).digest('hex')).toBe(entry.sha256)
      expectError(concat(input, Uint8Array.of(0)), 'TRAILING_DATA')
      expectError(input.subarray(0, -1))
    })
  }
})
test('full RFC static dictionary, including non-ASCII entries', () => {
  expect(data.length).toBe(122_784)
  // SHA-256 of upstream c/common/dictionary.bin, not of our unpacking code.
  expect(createHash('sha256').update(data).digest('hex')).toBe('20e42eb1b511c21806d4d227d07e5dd06877d8ce7b3a817f378f313653f35c70')
  for (let length = 4; length <= 24; length++) {
    expect(offsets[length + 1] - offsets[length]).toBe(length * 2 ** sizeBits[length])
  }
})

