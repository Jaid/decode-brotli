# Third-party notices

## Google Brotli

The following are adapted or copied from [google/brotli](https://github.com/google/brotli) at revision `a3abcbee0d945e51dddeec81e647ffe0cde182c2`:

| Local files | Upstream source |
| --- | --- |
| `src/decoder/decode.ts`, `src/decoder/dictionary.ts` | `js/decode.ts` |
| `test/synthetic.test.ts` and the zero-distance regression vector in `test/main.test.ts` | `js/decode_synth_test.ts` |
| `test/fixtures/upstream/*.br` | `js/test_data.tar` |

The decoder is copyright 2017 Google Inc. The synthetic tests are copyright 2023 Google Inc. The upstream project is copyright 2009, 2010, 2013–2016 by the Brotli Authors. These materials are distributed under the MIT license reproduced in [Brotli MIT license](docs/licenses/brotli.txt). Original source copyright notices are retained, including in the bundled JavaScript.

The dictionary is the complete standard dictionary from RFC 7932. Its original bytes are also available as upstream `c/common/dictionary.bin`.

The adaptation is maintained as TypeScript source, not as an automatically regenerated file. Changes from upstream and validation details are documented in [implementation notes](docs/implementation.md).
