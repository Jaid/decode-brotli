import {brotliCompressSync, brotliDecompressSync, constants} from 'node:zlib'
import decodeBrotli, {BrotliDecodeError, type BrotliErrorCode} from '../src/main.ts'
import {expect} from 'bun:test'

export function randomBytes(length: number, seed = 0x243f6a88): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    bytes[i] = seed >>> 24
  }
  return bytes
}

export function compress(input: Uint8Array | string, quality = 6, window = 22, mode = 0): Buffer {
  return brotliCompressSync(input, {params: {
    [constants.BROTLI_PARAM_QUALITY]: quality,
    [constants.BROTLI_PARAM_LGWIN]: window,
    [constants.BROTLI_PARAM_MODE]: mode,
  }})
}

/** Native Brotli normally ignores trailing data; normalize it to our strict API. */
export function nativeDecode(input: Uint8Array, maxOutputLength = 1_000_000): Uint8Array<ArrayBuffer> {
  // The node:zlib types do not model the result of the `info` option.
  const result = brotliDecompressSync(input, {info: true, maxOutputLength}) as unknown as {
    buffer: Buffer
    engine: {bytesWritten: number}
  }
  if (result.engine.bytesWritten !== input.length) throw new Error('Trailing bytes.')
  return new Uint8Array(result.buffer)
}

/** An explicit uncompressed meta-block with a 16-bit window, followed by an empty final block. */
export function uncompressed(input: Uint8Array): Uint8Array<ArrayBuffer> {
  if (input.length < 1 || input.length > 65536) throw new RangeError('Invalid test block size.')
  const output = new Uint8Array(input.length + 4)
  // WBITS=0, ISLAST=0, MNIBBLES=00, MLEN (16 bits), ISUNCOMPRESSED=1.
  const header = ((input.length - 1) << 4) | (1 << 20)
  output.set([header & 255, (header >>> 8) & 255, header >>> 16])
  output.set(input, 3)
  output[output.length - 1] = 3
  return output
}

/** A byte-aligned metadata meta-block with a 16-bit window, followed by a final block. */
export function metadata(input: Uint8Array): Uint8Array<ArrayBuffer> {
  if (input.length < 1 || input.length > 256) throw new RangeError('Invalid test metadata size.')
  const header = 0x2c | ((input.length - 1) << 7)
  return Uint8Array.from([header & 255, header >>> 8, ...input, 3])
}

export function concat(...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

/** Multiple small uncompressed blocks exercise aggregate limits and ring-buffer reuse. */
export function uncompressedBlocks(...blocks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = [...uncompressed(blocks[0]).subarray(0, -1)]
  for (const block of blocks.slice(1)) {
    // No window header after the first block: ISLAST, MNIBBLES, MLEN, ISUNCOMPRESSED.
    const header = ((block.length - 1) << 3) | (1 << 19)
    output.push(header & 255, (header >>> 8) & 255, header >>> 16, ...block)
  }
  output.push(3)
  return Uint8Array.from(output)
}

export const text = new TextEncoder()
export const utf8 = new TextDecoder()
export const sampleText = 'The quick brown fox jumps over the lazy dog. Compression dictionary transforms: INTERNATIONAL information © café 日本語 русский 😀.\n'
export const hello = Uint8Array.from([0x0b, 0x05, 0x80, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64, 0x03])
export function expectError(input: Uint8Array, code?: BrotliErrorCode, maxOutputLength?: number) {
  // Kept in individual tests instead of relying on native error text.
  let caught: unknown
  try {
    decodeBrotli(input, {maxOutputLength})
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(BrotliDecodeError)
  if (code) expect((caught as BrotliDecodeError).code).toBe(code)
}