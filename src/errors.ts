/** Stable categories for failures while decoding a Brotli stream. */
export type BrotliErrorCode = 'INVALID_DATA' | 'OUTPUT_LIMIT' | 'TRAILING_DATA' | 'UNEXPECTED_EOF'

/** Invalid input or a configured decompression limit was exceeded. */
export class BrotliDecodeError extends Error {
  override readonly name = 'BrotliDecodeError'

  constructor(
    message: string,
    readonly code: BrotliErrorCode,
    /** Approximate byte position in the supplied view, not its backing buffer. */
    readonly byteOffset: number,
    /** Internal reference-decoder diagnostic, when available. */
    readonly decoderCode?: number,
  ) {
    super(message)
  }
}

/** Reference-decoder diagnostics, kept separate from the stable public categories. */
export const decoderMessages: Readonly<Record<number, string>> = {
  [-2]: 'Invalid code length table.',
  [-3]: 'Invalid context map.',
  [-4]: 'Invalid Huffman code histogram.',
  [-5]: 'Nonzero padding bits.',
  [-6]: 'Nonzero reserved bit.',
  [-7]: 'Duplicate simple Huffman symbol.',
  [-8]: 'Noncanonical meta-block length.',
  [-9]: 'Invalid backward reference or dictionary transform.',
  [-10]: 'Invalid meta-block length.',
  [-11]: 'Invalid window size (expected RFC 7932 Brotli).',
  [-12]: 'Invalid backward distance.',
  [-13]: 'Unexpected end of Brotli input.',
  [-15]: 'Huffman symbol is out of range.',
  [-16]: 'Unexpected end of Brotli input.',
  [-17]: 'Unexpected bytes after the Brotli stream.',
  [-18]: 'Incomplete Huffman tree.',
}
