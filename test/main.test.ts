import {describe, expect, test} from 'bun:test'
import {runInNewContext} from 'node:vm'
import decodeBrotli, {decodeBrotli as namedDecode, BrotliDecodeError} from '../src/main.ts'
import type {BrotliInput, DecodeBrotliOptions} from '../src/main.ts'
import {compress, concat, expectError, hello, metadata, nativeDecode, randomBytes, sampleText, text, uncompressed, uncompressedBlocks, utf8} from './helpers.ts'

describe('public API', () => {
  test('default and named exports decode a fixed vector', () => {
    expect(namedDecode).toBe(decodeBrotli)
    const decoded = decodeBrotli(hello)
    expect(decoded).toBeInstanceOf(Uint8Array)
    expect(utf8.decode(decoded)).toBe('hello world')
    expect(decoded.byteOffset).toBe(0)
    expect(decoded.buffer.byteLength).toBe(decoded.length)
    expect(Buffer.isBuffer(decoded)).toBe(false)
  })

  test('empty stream is valid, empty input is not', () => {
    for (const value of [0x06, 0x3b]) expect(decodeBrotli(Uint8Array.of(value))).toEqual(new Uint8Array())
    expectError(new Uint8Array(), 'UNEXPECTED_EOF')
  })

  test('accepts ArrayBuffer, Buffer, typed arrays and DataView with exact view boundaries', () => {
    const backing = concat(Uint8Array.of(0xee, 0xff), hello, Uint8Array.of(0xcc, 0xdd, 0xee))
    const inputs: BrotliInput[] = [
      hello.slice().buffer,
      Buffer.from(hello),
      backing.subarray(2, 2 + hello.length),
      new Int8Array(backing.buffer, 2, hello.length),
      new DataView(backing.buffer, 2, hello.length),
      Buffer.from(backing.buffer, 2, hello.length),
    ]
    const shared = new SharedArrayBuffer(hello.length)
    new Uint8Array(shared).set(hello)
    inputs.push(new Uint8Array(shared))
    for (const input of inputs) expect(utf8.decode(decodeBrotli(input))).toBe('hello world')
    const even = uncompressed(Uint8Array.of(42, 42))
    expect(utf8.decode(decodeBrotli(new Uint16Array(even.buffer as ArrayBuffer)))).toBe('**')
  })

  test('accepts cross-realm buffers and rejects detached buffers', () => {
    const foreign = runInNewContext('Uint8Array.of(6).buffer') as ArrayBuffer
    expect(decodeBrotli(foreign)).toHaveLength(0)
    const buffer = new ArrayBuffer(1)
    const view = new Uint8Array(buffer)
    buffer.transfer()
    expect(() => decodeBrotli(buffer)).toThrow(TypeError)
    expect(() => decodeBrotli(view)).toThrow(TypeError)
  })

  test('does not mutate or alias input and has no state leakage between calls', () => {
    const original = hello.slice()
    const first = decodeBrotli(hello)
    first.fill(0)
    expect(hello).toEqual(original)
    expectError(Uint8Array.of(0xff))
    expect(utf8.decode(decodeBrotli(hello))).toBe('hello world')
    const other = compress(sampleText.repeat(300))
    expect(utf8.decode(decodeBrotli(other))).toBe(sampleText.repeat(300))
    expect(utf8.decode(decodeBrotli(hello))).toBe('hello world')
  })

  test('rejects invalid input types rather than silently coercing them', () => {
    for (const input of [undefined, null, 12, '', [], [6], {length: 1}, {buffer: hello.buffer}, {[Symbol.toStringTag]: 'ArrayBuffer'}, new SharedArrayBuffer(1)]) {
      expect(() => decodeBrotli(input as BrotliInput)).toThrow(TypeError)
    }
  })

  test('validates options', () => {
    for (const options of [null, 0, true, 'test', []]) {
      expect(() => decodeBrotli(hello, options as DecodeBrotliOptions)).toThrow(TypeError)
    }
    for (const maxOutputLength of [-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '100', null, 1n]) {
      expect(() => decodeBrotli(hello, {maxOutputLength} as DecodeBrotliOptions)).toThrow(RangeError)
    }
    expect(decodeBrotli(hello, {maxOutputLength: Number.MAX_SAFE_INTEGER})).toHaveLength(11)
  })
})

describe('resource limits', () => {
  test('zero and exact limits', () => {
    expect(decodeBrotli(Uint8Array.of(6), {maxOutputLength: 0})).toHaveLength(0)
    expectError(hello, 'OUTPUT_LIMIT', 0)
    expectError(hello, 'OUTPUT_LIMIT', 10)
    expect(decodeBrotli(hello, {maxOutputLength: 11})).toHaveLength(11)
  })

  test.each([65535, 65536, 65537, 131072])('exact output buffer boundary: %d', length => {
    const input = compress(new Uint8Array(length).fill(65))
    expect(decodeBrotli(input, {maxOutputLength: length})).toEqual(new Uint8Array(length).fill(65))
    expectError(input, 'OUTPUT_LIMIT', length - 1)
    expectError(concat(input, Uint8Array.of(0)), 'TRAILING_DATA', length)
    expectError(input.subarray(0, -1), undefined, length)
  })

  test('limits sum over meta-blocks and do not count metadata', () => {
    const a = text.encode('first ')
    const b = text.encode('second')
    const input = uncompressedBlocks(a, b)
    expect(nativeDecode(input)).toEqual(concat(a, b))
    expect(decodeBrotli(input, {maxOutputLength: 12})).toEqual(concat(a, b))
    expectError(input, 'OUTPUT_LIMIT', 11)
    expect(decodeBrotli(metadata(randomBytes(200)), {maxOutputLength: 0})).toHaveLength(0)
  })

  test('rejects a huge declared block before reading its payload', () => {
    // A final compressed meta-block declaring 16_777_216 bytes, with no payload.
    expectError(Uint8Array.of(0x9b, 0xff, 0xff, 0xff), 'OUTPUT_LIMIT', 100)
  })
})

describe('validation', () => {
  test('rejects truncation at every byte of varied streams', () => {
    for (const compressed of [hello, compress(sampleText.repeat(8), 11), uncompressed(randomBytes(200)), metadata(randomBytes(30))]) {
      for (let length = 0; length < compressed.length; length++) expectError(compressed.subarray(0, length))
      expect(decodeBrotli(compressed)).toEqual(nativeDecode(compressed))
    }
  })

  test('rejects trailing bytes even beyond a full bit-reader refill', () => {
    for (const length of [1, 4000, 4095, 4096, 4097, 9000]) {
      expectError(concat(Uint8Array.of(6), new Uint8Array(length)), 'TRAILING_DATA')
      expectError(concat(hello, new Uint8Array(length)), 'TRAILING_DATA')
    }
    expectError(concat(hello, hello), 'TRAILING_DATA')
  })

  test('rejects nonzero padding, reserved bits and unsupported window extension', () => {
    expectError(Uint8Array.of(0x86), 'INVALID_DATA')
    expectError(Uint8Array.of(0x3c, 0, 3), 'INVALID_DATA')
    expectError(Uint8Array.of(0x11, 0x1e, 3), 'INVALID_DATA')
  })

  test('rejects a zero backward distance rather than copying unwritten history', () => {
    // Adapted from the upstream negative-distance vector: cached distance 2,
    // followed by short code 12 (cached distance minus 2) instead of minus 3.
    const input = Uint8Array.from([
      0x1b, 0x0f, 0, 0, 0, 0, 0x80, 0xe3, 0xb4, 0x0d, 0, 0,
      0x07, 0x5b, 0x26, 0x31, 0x40, 0x02, 0, 0xe0, 0x4e, 0x1b,
      0x41, 0x02, 0x01, 0x42, 0x01, 0x42, 0x01, 0x42, 0x01, 0x42,
      0x01, 0x42, 0x01, 0x0c,
    ])
    expectError(input, 'INVALID_DATA')
    expect(() => nativeDecode(input)).toThrow()
  })

  test('provides structured diagnostics', () => {
    try {
      decodeBrotli(concat(hello, Uint8Array.of(0)))
      throw new Error('Expected a decode failure.')
    } catch (error) {
      expect(error).toBeInstanceOf(BrotliDecodeError)
      const decodedError = error as BrotliDecodeError
      expect(decodedError.name).toBe('BrotliDecodeError')
      expect(decodedError.code).toBe('TRAILING_DATA')
      expect(decodedError.byteOffset).toBe(hello.length)
      expect(decodedError.decoderCode).toBe(-17)
      expect(decodedError.message).toContain('after')
    }
  })
})

describe('bit-reader and ring-buffer boundaries', () => {
  test.each([1, 2, 3, 4090, 4091, 4092, 4093, 4094, 4095, 4096, 4097, 8192, 16383, 16384, 16385, 65535, 65536])('raw block length %d', length => {
    const expected = randomBytes(length)
    const input = uncompressed(expected)
    expect(decodeBrotli(input)).toEqual(expected)
    expect(nativeDecode(input)).toEqual(expected)
    for (const trim of [1, 2, 3]) expectError(input.subarray(0, -trim))
    expectError(concat(input, Uint8Array.of(0)), 'TRAILING_DATA')
  })

  test('copies across a full history window with many raw blocks', () => {
    const blocks = Array.from({length: 30}, (_, seed) => randomBytes(10000, seed + 1))
    const input = uncompressedBlocks(...blocks)
    const expected = concat(...blocks)
    expect(decodeBrotli(input)).toEqual(expected)
    expect(nativeDecode(input)).toEqual(expected)
  })

  test('ignores metadata payloads', () => {
    expect(decodeBrotli(Uint8Array.of(1, 11, 0, 42, 3))).toHaveLength(0)
    for (const length of [1, 2, 3, 255, 256]) {
      const input = metadata(randomBytes(length))
      expect(decodeBrotli(input)).toEqual(nativeDecode(input))
      expectError(input.subarray(0, -1))
    }
  })
})

// Round trips complement hand-authored format fixtures with a separate encoder.
describe('native encoder interoperability', () => {
  test.each(Array.from({length: 12}, (_, i) => i))('all qualities: %d', quality => {
    for (const input of [new Uint8Array(), randomBytes(12000), text.encode(sampleText.repeat(300)), new Uint8Array(70000).fill(255)]) {
      expect(decodeBrotli(compress(input, quality))).toEqual(input)
    }
  })

  test.each(Array.from({length: 15}, (_, i) => i + 10))('window bits: %d', window => {
    const input = concat(randomBytes(5000), text.encode(sampleText.repeat(100)), randomBytes(5000))
    expect(decodeBrotli(compress(input, 8, window))).toEqual(input)
  })

  test.each([0, 1, 2])('encoder mode: %d', mode => {
    const input = text.encode(sampleText.repeat(100))
    expect(decodeBrotli(compress(input, 11, 22, mode))).toEqual(input)
  })

  test('deterministic randomized data, entropy and sizes', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const input = randomBytes((seed * 1543) % 100003, seed)
      const mask = (1 << (seed % 8 + 1)) - 1
      for (let i = 0; i < input.length; i++) input[i] &= mask
      expect(decodeBrotli(compress(input, seed % 12, 10 + seed % 15))).toEqual(input)
    }
  })
})
