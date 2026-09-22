import {expect, test} from 'bun:test'
import decodeBrotli, {BrotliDecodeError} from '../src/main.ts'
import {compress, concat, nativeDecode, randomBytes, sampleText, text} from './helpers.ts'

test('seeded malformed-input differential checks against native Brotli', () => {
  const count = Number(Bun.env.BROTLI_FUZZ_CASES ?? 3000)
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError('Invalid BROTLI_FUZZ_CASES.')
  let state = 0x12345678
  function random(max: number): number {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) % max
  }
  const sources = [text.encode(sampleText.repeat(20)), randomBytes(511), new Uint8Array(8192).fill(97), text.encode('hello world'), new Uint8Array()]
  const pool = sources.flatMap(source => [0, 4, 11].map(quality => compress(source, quality)))
  for (let i = 0; i < count; i++) {
    let input: Uint8Array = Uint8Array.from(pool[random(pool.length)])
    switch (i % 5) {
      case 0:
        input = randomBytes(random(80), random(0x7fffffff) + 1)
        break
      case 1:
        input = input.slice(0, random(input.length))
        break
      case 2:
        input = concat(input, randomBytes(random(5000) + 1, random(0x7fffffff)))
        break
      default:
        for (let j = 0, n = random(3) + 1; j < n; j++) input[random(input.length)] ^= 1 << random(8)
    }
    let native: Uint8Array | undefined
    try { native = nativeDecode(input, 65536) } catch { /* Native rejection is the expected outcome for most mutations. */ }
    let actual: Uint8Array | undefined
    try {
      actual = decodeBrotli(input, {maxOutputLength: 65536})
    } catch (error) {
      expect(error).toBeInstanceOf(BrotliDecodeError)
    }
    if (Boolean(actual) !== Boolean(native) || (actual && native && !Buffer.from(actual).equals(native))) {
      throw new Error(`Differential mismatch at case ${i}: native=${native?.length}, JavaScript=${actual?.length}, input=${Buffer.from(input).toString('hex')}`)
    }
  }
}, 120000)
