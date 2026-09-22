<center><a href="https://npmjs.com/package/decode-brotli"><img src="https://shieldcn.dev/npm/v/decode-brotli.svg?variant=secondary&logo=npm&label=latest+version" alt="Latest version on npm"/></a> <a href="https://github.com/Jaid/decode-brotli/raw/HEAD/license.txt"><img src="https://shieldcn.dev/github/license/Jaid/decode-brotli.svg?variant=secondary" alt="License"/></a></center>

# decode-brotli

small but complete JavaScript-only Brotli decompressor

## intro

Synchronous, ESM-only and dependency-free at runtime. Works in current browsers, Bun and Node.js without native codecs, WebAssembly, external dictionary files or network access.

## features

- All RFC 7932 window sizes, compressed and uncompressed meta-blocks and metadata.
- Simple and complex Huffman codes, block switching, context modeling, distance caches and overlapping history copies.
- The complete 122 784-byte static dictionary and all 121 standard transforms, including non-ASCII entries.
- Strict single-stream decoding: truncated input, invalid codes, invalid padding and trailing bytes are rejected. Concatenated streams are not accepted.
- An encoded empty stream returns an empty array. A zero-byte input is not an encoded stream.

Streaming, encoding, nonstandard large-window Brotli and external/shared dictionary extensions are not included. A normal Brotli stream’s built-in static dictionary is always available.

See [implementation notes](docs/implementation.md) for decoder provenance and maintenance details.

## installation

<a href="https://npmjs.com/package/decode-brotli"><img src="https://shieldcn.dev/badge/npm-decode--brotli-C23039.svg?variant=secondary&logo=npm" alt="decode-brotli on npm"/></a>

```sh
npm install --save decode-brotli
```

## usage

### API

```typescript
import decodeBrotli, {
  BrotliDecodeError,
  type BrotliInput,
  type DecodeBrotliOptions,
  type BrotliErrorCode,
} from 'decode-brotli'

const raw: Uint8Array<ArrayBuffer> = decodeBrotli(buffer)
```

A named `decodeBrotli` export is also available and is the same function as the default export.

#### Input

`BrotliInput` is `ArrayBuffer | ArrayBufferView`. This includes signed and unsigned typed arrays, `Buffer` and `DataView`. Multi-byte typed arrays are interpreted as their underlying bytes, not converted element values. Views with nonzero offsets and buffers from other realms are supported.

Pass exactly one complete RFC 7932 Brotli stream. A `Blob`, `Response`, string, plain array or stream is not accepted. Obtain the bytes first:

```typescript
const compressed = await Bun.file('document.br').bytes()
const raw = decodeBrotli(compressed)
await Bun.write('document', raw)
```

In a browser, a file or blob works similarly:

```typescript
const raw = decodeBrotli(await file.arrayBuffer())
```

Browsers usually decode HTTP `Content-Encoding: br` automatically. Do not decode an already decoded fetch response again. A fetched raw `.br` file must be served without that content encoding if the application will decode it itself.

A raw `SharedArrayBuffer` is not accepted, but a typed-array view over one is. The caller must prevent concurrent changes to shared bytes during decoding. Detached buffers throw `TypeError`.

#### Options

`DecodeBrotliOptions` has one optional property:

| Property | Default | Meaning |
| --- | --- | --- |
| `maxOutputLength` | `256_000_000` | Maximum total decompressed byte length across all non-metadata meta-blocks. |

The limit must be a nonnegative safe integer. `0` permits only empty output; `Infinity`, fractions and negative numbers are rejected. An exact-size output is allowed. The default is used when the property is omitted or `undefined`.

#### Result

A newly allocated `Uint8Array<ArrayBuffer>` containing all decompressed bytes. Its byte offset is zero and its backing buffer is exactly the output length. The output neither aliases the input nor retains the decoder’s history storage.

Text conversion is explicit:

```typescript
const text = new TextDecoder('utf-8', {fatal: true}).decode(raw)
```

#### Errors

`BrotliDecodeError` extends `Error` with a stable `code` category:

| Code | Meaning |
| --- | --- |
| `INVALID_DATA` | Invalid Brotli structure, padding, window, prefix code, distance or dictionary reference. |
| `UNEXPECTED_EOF` | The decoder required bytes beyond the end of the input. |
| `TRAILING_DATA` | Bytes remain after the first complete stream. This includes concatenated streams. |
| `OUTPUT_LIMIT` | A declared output size or decoded output exceeds `maxOutputLength`. |

Truncation can also manifest as an invalid code structure or an oversized declaration. The decoder reports the first detected failure rather than promising a specific category for every truncation or corruption.

`byteOffset` is an approximate byte position relative to the supplied view. Lookahead can place it past the end of malformed input. `decoderCode`, when present, is a numeric reference-decoder diagnostic; do not depend on its value for application control flow. Error messages are diagnostic text, not a stable interface.

Invalid argument types throw `TypeError`. An invalid output limit throws `RangeError`. Runtime allocation failures may also throw `RangeError`; a configured limit does not guarantee the runtime can allocate that much memory.

#### Resource and integrity considerations

Decoding is synchronous and blocks the calling thread. For large or untrusted payloads in a UI, use a worker. There is no cancellation or streaming API.

Peak memory includes the compressed input, output chunks, the final contiguous output, history and Huffman tables. Output assembly can briefly require approximately twice the decompressed size, plus a history buffer of up to 16 777 216 bytes and other working storage. The output limit is not a total-process memory limit or a CPU-time limit. Metadata processing also consumes time without contributing to output size. Bound compressed input size separately where necessary.

Brotli provides no built-in checksum. A changed bit can still describe a valid but different output. Use an external digest or authenticated transport when integrity matters.

## legal

The decoding core, dictionary and synthetic tests are adapted from Google’s Brotli project. See [third-party notices](THIRD_PARTY_NOTICES.md) for provenance and attribution. The project’s own code is MIT licensed.

## development

All fixtures needed by the regular tests are checked into the repository.

Additional release validation:

```sh
bun run build
bun run test:fuzz
bun run test:browser
```

`test:fuzz` runs 100 000 deterministic differential cases against native Brotli. `test:browser` runs the aggressive production bundle in a current Chromium-family browser against all 19 upstream corpus vectors and error handling.

`bun run build` produces the browser-compatible ESM package under `dist/decode-brotli/production/`, including `lib.js`, declarations, documentation and third-party notices.

The native Brotli encoder/decoder is used only as an independent test oracle. The production build contains neither test fixtures nor development dependencies.

### setting up

```sh
git clone git@github.com:Jaid/decode-brotli.git
cd decode-brotli
bun install
```

### linting

```sh
bun run lint
```

### testing

```sh
bun run test
```

## license

[MIT License](https://github.com/Jaid/decode-brotli/raw/HEAD/license.txt)<br>
Copyright © 2026, Jaid \<jaid.jsx@gmail.com> (https://github.com/jaid)

<!--
readme generated with tldw v9.7.0 from ./docs and ./docs/tldw
github.com/Jaid/tldw
-->
