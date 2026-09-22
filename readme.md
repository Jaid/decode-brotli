<center><a href="https://npmjs.com/package/decode-brotli"><img src="https://shieldcn.dev/npm/v/decode-brotli.svg?variant=secondary&logo=npm&label=latest+version" alt="Latest version on npm"/></a> <a href="https://github.com/Jaid/decode-brotli/raw/HEAD/license.txt"><img src="https://shieldcn.dev/github/license/Jaid/decode-brotli.svg?variant=secondary" alt="License"/></a></center>

# decode-brotli

A small, complete RFC 7932 Brotli decompressor implemented entirely in JavaScript.

## Installation

```sh
npm install decode-brotli
```

Synchronous, ESM-only and dependency-free at runtime. Works in current browsers, Bun and Node.js without native codecs, WebAssembly, external dictionary files or network access.

## Usage

```typescript
import decodeBrotli from 'decode-brotli'

const raw = decodeBrotli(buffer) // Uint8Array
const text = new TextDecoder().decode(raw)
```

The input may be an `ArrayBuffer` or any `ArrayBuffer` view, including `Uint8Array`, `Buffer` and `DataView`. Only the view’s byte range is read. The returned `Uint8Array` owns its storage; the input is never modified.

```typescript
import decodeBrotli, {BrotliDecodeError} from 'decode-brotli'

try {
  const raw = decodeBrotli(compressed, {maxOutputLength: 8_000_000})
  console.log(raw.byteLength)
} catch (error) {
  if (error instanceof BrotliDecodeError) {
    console.error(error.code, error.message)
  } else {
    throw error
  }
}
```

The default output limit is **256 000 000 bytes**. Use an application-appropriate limit for untrusted data. Declared meta-block sizes are checked before allocating history storage or decoding their payloads.

## Coverage and behavior

- All RFC 7932 window sizes, compressed and uncompressed meta-blocks and metadata.
- Simple and complex Huffman codes, block switching, context modeling, distance caches and overlapping history copies.
- The complete 122 784-byte static dictionary and all 121 standard transforms, including non-ASCII entries.
- Strict single-stream decoding: truncated input, invalid codes, invalid padding and trailing bytes are rejected. Concatenated streams are not accepted.
- An encoded empty stream returns an empty array. A zero-byte input is not an encoded stream.

Streaming, encoding, nonstandard large-window Brotli and external/shared dictionary extensions are not included. A normal Brotli stream’s built-in static dictionary is always available.

See [API details](docs/usage.md) and [implementation notes](docs/implementation.md).

## Development

Requires current Bun and TypeScript. All fixtures needed by the regular tests are in the repository.

```sh
bun install --frozen-lockfile
bun run lint
bun test
bun run build
bun run test:fuzz
bun run test:browser
```

`test:browser` requires a local current Chromium binary, autodetected as `chromium` or `google-chrome`, or selected through `CHROMIUM_BIN`. It runs the production bundle against the upstream corpus. Its isolated test browser disables the sandbox; do not use this runner for untrusted web content.

`bun run build` produces a self-contained browser-compatible ESM package under `dist/decode-brotli/production/`, including `lib.js`, declarations, documentation and third-party notices.

The native Brotli encoder/decoder is used only as an independent oracle in tests. The production build contains neither test fixtures nor development dependencies.

## License

MIT for this project. The decoding core, dictionary and synthetic tests are adapted from Google’s Brotli project. See [third-party notices](THIRD_PARTY_NOTICES.md) for provenance and attribution.
