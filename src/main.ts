import {decode} from './decoder/decode.ts'

const arrayBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!

export {BrotliDecodeError} from './errors.ts'
export type {BrotliErrorCode} from './errors.ts'

/** A byte buffer or a view whose exact byte range contains one Brotli stream. */
export type BrotliInput = ArrayBuffer | ArrayBufferView

export interface DecodeBrotliOptions {
  /** Maximum decompressed byte length. Defaults to 256_000_000. */
  maxOutputLength?: number
}

/**
 * Synchronously decodes one complete RFC 7932 Brotli stream using only JavaScript.
 *
 * Returns an independently owned Uint8Array. The input is never modified. All
 * supplied bytes must belong to the stream; trailing data and concatenated
 * streams are rejected. Text decoding is left to the caller.
 *
 * @throws {BrotliDecodeError} Invalid, truncated or oversized compressed data.
 * @throws {TypeError} Unsupported input or options.
 * @throws {RangeError} An invalid output limit or a runtime allocation failure.
 */
export default function decodeBrotli(input: BrotliInput, options: DecodeBrotliOptions = {}): Uint8Array<ArrayBuffer> {
  let bytes: Int8Array
  if (ArrayBuffer.isView(input)) {
    bytes = new Int8Array(input.buffer, input.byteOffset, input.byteLength)
  } else {
    try {
      // Use the native brand check so ArrayBuffers from other realms work too.
      bytes = new Int8Array(input, 0, arrayBufferByteLength.call(input))
    } catch {
      throw new TypeError('Expected an ArrayBuffer or an ArrayBuffer view.')
    }
  }
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Expected a decode options object.')
  }
  const maxOutputLength = options.maxOutputLength === undefined ? 256_000_000 : options.maxOutputLength
  if (!Number.isSafeInteger(maxOutputLength) || maxOutputLength < 0) {
    throw new RangeError('maxOutputLength must be a nonnegative safe integer.')
  }
  return decode(bytes, maxOutputLength)
}

export {decodeBrotli}
