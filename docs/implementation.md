# Implementation notes

## Scope and structure

The starter specified a “small but complete JavaScript-only Brotli decompressor” with a synchronous `decodeBrotli(buffer)` entry point. Streaming was explicitly optional. This implementation targets the complete standard [RFC 7932](https://www.rfc-editor.org/rfc/rfc7932), not later optional extensions.

- `src/main.ts`: public input normalization, options validation and exports.
- `src/errors.ts`: structured errors and reference diagnostics.
- `src/decoder/decode.ts`: bit reader, Huffman decoding, context maps, meta-block processing, history copies, dictionary transforms and the one-shot driver.
- `src/decoder/dictionary.ts`: the packed standard dictionary and its offset tables.

The core is adapted from the MIT-licensed Google Brotli JavaScript/TypeScript implementation at revision `a3abcbee0d945e51dddeec81e647ffe0cde182c2`. Upstream translates its Java decoder into this implementation. Function names, table layout and numeric state/error conventions are largely retained to make comparison with the reference implementation practical. See [third-party notices](../THIRD_PARTY_NOTICES.md).

No compression package was installed. Production code only uses ECMAScript features and typed arrays. There are no runtime imports outside the bundled library, no WebAssembly and no native or browser decompression APIs.

## Local changes to the reference decoder

1. Reformatted the compact generated TypeScript for inspection and separated the packed dictionary from the state machine.
2. Replaced the signed-array public wrapper with a typed, unsigned, independently owned output API. Input views preserve byte offsets and lengths, including cross-realm buffers.
3. Added a validated output limit, summed across declared meta-block sizes before history allocation or payload decoding. The driver also checks actual output size.
4. Replaced generic numeric errors with `BrotliDecodeError` categories and diagnostics.
5. Made end-of-stream validation compare the absolute consumed byte position with the complete input length. The upstream streaming check only checks trailing bytes once EOF has been read, so trailing data could otherwise go unnoticed after a full lookahead refill.
6. Cleared byte and short-buffer lookahead after a partial final refill, avoiding stale bytes from the previous block.
7. Reject oversized literal insertions before emitting them and reject zero backward distances as well as negative distances.
8. Removed extension entry points and paths for eager streaming output, compound/custom dictionaries, large windows and nonstandard shift transforms. Standard Brotli windows are 10–24 bits.
9. Use 65 536-byte internal output chunks and decoder completion status, rather than treating a partially filled output chunk as the only indication of completion. Exact chunk-boundary endings are validated too.

The per-call `State` object contains all mutable decoding state. The shared tables and dictionary are initialized once and only read by the decoder. The dictionary module is internal, not a supported package subpath.

The original packed dictionary representation is retained to keep the standalone bundle small. It expands to exactly 122 784 bytes; a test compares its SHA-256 with upstream `c/common/dictionary.bin`. All 121 RFC transforms are included. Dictionary strings are opaque data: do not normalize Unicode or edit spelling inside them.

## Validation

`bun run lint` checks the entire source, tests and scripts with strict TypeScript and unused-local checks. The declaration build additionally compiles production source with no Bun or Node type globals.

`bun test` covers:

- Public types at compile time and runtime argument validation, subviews, shared views, cross-realm buffers, detached buffers and non-aliasing output.
- Empty input/output, metadata, uncompressed blocks, input-refill boundaries, history wraparound and exact output-chunk boundaries.
- Limits at zero, exact sizes and aggregate multi-block sizes.
- All native encoder qualities, standard window settings and encoder modes, plus seeded randomized round trips.
- 46 upstream synthetic tests covering dictionary transforms, block switching, distance codes, Huffman validation, context maps, mixed meta-blocks, zero-bit symbols and malformed inputs. The upstream pending trailing-data test is enabled with the strict rejection expectation required by this API.
- 19 upstream corpus files, checked by output length and SHA-256. The expected outputs were first validated against the upstream CRC-64 fingerprints in the fixture filenames.
- 3000 seeded malformed-input differential cases against native Brotli, including random bytes, truncations, mutations and trailing data. The native oracle is normalized to reject unconsumed trailing bytes.

`bun run test:fuzz` expands the differential run to 100 000 cases. Set `BROTLI_FUZZ_CASES` when invoking that test directly to use a different count. This is deterministic regression testing, not a substitute for a long-running coverage-guided security fuzzer.

`bun run test:browser` runs the actual production bundle in headless Chromium, checks all 19 corpus outputs with Web Crypto SHA-256 and verifies error handling. It requires no browser automation npm package. All browser assets are served from a temporary local server.

## Maintenance

Keep the RFC dictionary and transform table exact. When updating from upstream, compare against the pinned revision and reapply the local validation and resource-limit changes deliberately; do not overwrite the files with unreviewed generated code. Run lint, the standard tests, the expanded differential run and the real-browser check afterward.

Release builds are minified browser-compatible ESM with separate declarations. The package `files` allowlist excludes tests, fixtures, scripts and temporary artifacts. Run `bun run validate` before release.

Useful future work would be sustained coverage-guided fuzzing and workload-specific performance measurements. Streaming and extension dictionaries would require a separately designed API, not a compatibility shim around the current one-shot function.
