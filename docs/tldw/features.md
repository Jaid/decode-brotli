- All RFC 7932 window sizes, compressed and uncompressed meta-blocks and metadata.
- Simple and complex Huffman codes, block switching, context modeling, distance caches and overlapping history copies.
- The complete 122 784-byte static dictionary and all 121 standard transforms, including non-ASCII entries.
- Strict single-stream decoding: truncated input, invalid codes, invalid padding and trailing bytes are rejected. Concatenated streams are not accepted.
- An encoded empty stream returns an empty array. A zero-byte input is not an encoded stream.

Streaming, encoding, nonstandard large-window Brotli and external/shared dictionary extensions are not included. A normal Brotli stream’s built-in static dictionary is always available.

See [implementation notes](docs/implementation.md) for decoder provenance and maintenance details.
