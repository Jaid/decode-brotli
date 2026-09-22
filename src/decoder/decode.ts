/*! Copyright 2017 Google Inc. All Rights Reserved.
 * Distributed under the MIT license. See LICENSE and THIRD_PARTY_NOTICES.md.
 * Adapted from google/brotli js/decode.ts; see docs/implementation.md.
 */
import {data, offsets, sizeBits} from './dictionary.ts'
import {BrotliDecodeError, decoderMessages} from '../errors.ts'

const MAX_HUFFMAN_TABLE_SIZE: Int32Array = Int32Array.from([256, 402, 436, 468, 500, 534, 566, 598, 630, 662, 694, 726, 758, 790, 822, 854, 886, 920, 952, 984, 1016, 1048, 1080]);
const CODE_LENGTH_CODE_ORDER: Int32Array = Int32Array.from([1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
const DISTANCE_SHORT_CODE_INDEX_OFFSET: Int32Array = Int32Array.from([0, 3, 2, 1, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3, 3, 3]);
const DISTANCE_SHORT_CODE_VALUE_OFFSET: Int32Array = Int32Array.from([0, 0, 0, 0, -1, 1, -2, 2, -3, 3, -1, 1, -2, 2, -3, 3]);
const FIXED_TABLE: Int32Array = Int32Array.from([0x020000, 0x020004, 0x020003, 0x030002, 0x020000, 0x020004, 0x020003, 0x040001, 0x020000, 0x020004, 0x020003, 0x030002, 0x020000, 0x020004, 0x020003, 0x040005]);
const BLOCK_LENGTH_OFFSET: Int32Array = Int32Array.from([1, 5, 9, 13, 17, 25, 33, 41, 49, 65, 81, 97, 113, 145, 177, 209, 241, 305, 369, 497, 753, 1265, 2289, 4337, 8433, 16625]);
const BLOCK_LENGTH_N_BITS: Int32Array = Int32Array.from([2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 24]);
const INSERT_LENGTH_N_BITS: Int16Array = Int16Array.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x02, 0x02, 0x03, 0x03, 0x04, 0x04, 0x05, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0C, 0x0E, 0x18]);
const COPY_LENGTH_N_BITS: Int16Array = Int16Array.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x02, 0x02, 0x03, 0x03, 0x04, 0x04, 0x05, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x18]);
const CMD_LOOKUP = new Int16Array(2816);
{
    unpackCommandLookupTable(CMD_LOOKUP);
}
function log2floor(i: number): number {
    let result: number = -1;
    let step = 16;
    let v: number = i;
    while (step > 0) {
        let next: number = v >> step;
        if (next !== 0) {
            result += step;
            v = next;
        }
        step = step >> 1;
    }
    return result + v;
}
function calculateDistanceAlphabetSize(npostfix: number, ndirect: number, maxndistbits: number): number { return 16 + ndirect + 2 * (maxndistbits << npostfix); }

function unpackCommandLookupTable(cmdLookup: Int16Array): void {
    const insertLengthOffsets = new Int32Array(24);
    const copyLengthOffsets = new Int32Array(24);
    copyLengthOffsets[0] = 2;
    for (let i = 0; i < 23; ++i) {
        insertLengthOffsets[i + 1] = insertLengthOffsets[i] + (1 << INSERT_LENGTH_N_BITS[i]);
        copyLengthOffsets[i + 1] = copyLengthOffsets[i] + (1 << COPY_LENGTH_N_BITS[i]);
    }
    for (let cmdCode = 0; cmdCode < 704; ++cmdCode) {
        let rangeIdx: number = cmdCode >> 6;
        let distanceContextOffset: number = -4;
        if (rangeIdx >= 2) {
            rangeIdx -= 2;
            distanceContextOffset = 0;
        }
        const insertCode: number = (((0x29850 >> (rangeIdx * 2)) & 0x3) << 3) | ((cmdCode >> 3) & 7);
        const copyCode: number = (((0x26244 >> (rangeIdx * 2)) & 0x3) << 3) | (cmdCode & 7);
        const copyLengthOffset: number = copyLengthOffsets[copyCode];
        const distanceContext: number = distanceContextOffset + Math.min(copyLengthOffset, 5) - 2;
        const index: number = cmdCode * 4;
        cmdLookup[index] = INSERT_LENGTH_N_BITS[insertCode] | (COPY_LENGTH_N_BITS[copyCode] << 8);
        cmdLookup[index + 1] = insertLengthOffsets[insertCode];
        cmdLookup[index + 2] = copyLengthOffsets[copyCode];
        cmdLookup[index + 3] = distanceContext;
    }
}
function decodeWindowBits(s: State): number {
    if (s.bitOffset >= 16) {
        s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
        s.bitOffset -= 16;
    }
    if (readFewBits(s, 1) === 0)
        return 16;
    let n: number = readFewBits(s, 3);
    if (n !== 0)
        return 17 + n;
    n = readFewBits(s, 3);
    if (n !== 0) {
        if (n === 1) return -1;
        return 8 + n;
    }
    return 17;
}
function initState(s: State): number {
    if (s.runningState !== 0)
        return makeError(s, -26);
    s.blockTrees = new Int32Array(3091);
    s.blockTrees[0] = 7;
    s.distRbIdx = 3;
    const maxDistanceAlphabetLimit = calculateDistanceAlphabetSize(3, 120, 24);
    s.distExtraBits = new Int8Array(maxDistanceAlphabetLimit);
    s.distOffset = new Int32Array(maxDistanceAlphabetLimit);
    const result = initBitReader(s);
    if (result < 0)
        return result;
    s.runningState = 1;
    return 0;
}
function decodeVarLenUnsignedByte(s: State): number {
    if (s.bitOffset >= 16) {
        s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
        s.bitOffset -= 16;
    }
    if (readFewBits(s, 1) !== 0) {
        const n: number = readFewBits(s, 3);
        if (n === 0)
            return 1;
        return readFewBits(s, n) + (1 << n);
    }
    return 0;
}
function decodeMetaBlockLength(s: State): number {
    if (s.bitOffset >= 16) {
        s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
        s.bitOffset -= 16;
    }
    s.inputEnd = readFewBits(s, 1);
    s.metaBlockLength = 0;
    s.isUncompressed = 0;
    s.isMetadata = 0;
    if ((s.inputEnd !== 0) && readFewBits(s, 1) !== 0)
        return 0;
    const sizeNibbles: number = readFewBits(s, 2) + 4;
    if (sizeNibbles === 7) {
        s.isMetadata = 1;
        if (readFewBits(s, 1) !== 0)
            return makeError(s, -6);
        const sizeBytes: number = readFewBits(s, 2);
        if (sizeBytes === 0)
            return 0;
        for (let i = 0; i < sizeBytes; ++i) {
            if (s.bitOffset >= 16) {
                s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
                s.bitOffset -= 16;
            }
            const bits: number = readFewBits(s, 8);
            if (bits === 0 && i + 1 === sizeBytes && sizeBytes > 1)
                return makeError(s, -8);
            s.metaBlockLength += bits << (i * 8);
        }
    }
    else
        for (let i = 0; i < sizeNibbles; ++i) {
            if (s.bitOffset >= 16) {
                s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
                s.bitOffset -= 16;
            }
            const bits: number = readFewBits(s, 4);
            if (bits === 0 && i + 1 === sizeNibbles && sizeNibbles > 4)
                return makeError(s, -8);
            s.metaBlockLength += bits << (i * 4);
        }
    s.metaBlockLength++;
    if (s.inputEnd === 0)
        s.isUncompressed = readFewBits(s, 1);
    return 0;
}
function readSymbol(tableGroup: Int32Array, tableIdx: number, s: State): number {
    let offset: number = tableGroup[tableIdx];
    const v: number = s.accumulator32 >>> s.bitOffset;
    offset += v & 0xFF;
    const bits: number = tableGroup[offset] >> 16;
    const sym: number = tableGroup[offset] & 0xFFFF;
    if (bits <= 8) {
        s.bitOffset += bits;
        return sym;
    }
    offset += sym;
    const mask: number = (1 << bits) - 1;
    offset += (v & mask) >>> 8;
    s.bitOffset += (tableGroup[offset] >> 16) + 8;
    return tableGroup[offset] & 0xFFFF;
}
function readBlockLength(tableGroup: Int32Array, tableIdx: number, s: State): number {
    if (s.bitOffset >= 16) {
        s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
        s.bitOffset -= 16;
    }
    const code: number = readSymbol(tableGroup, tableIdx, s);
    const n: number = BLOCK_LENGTH_N_BITS[code];
    if (s.bitOffset >= 16) {
        s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
        s.bitOffset -= 16;
    }
    return BLOCK_LENGTH_OFFSET[code] + ((n <= 16) ? readFewBits(s, n) : readManyBits(s, n));
}
function moveToFront(v: Int32Array, index: number): void {
    let i: number = index;
    const value: number = v[i];
    while (i > 0) {
        v[i] = v[i - 1];
        i--;
    }
    v[0] = value;
}
function inverseMoveToFrontTransform(v: Int8Array, vLen: number): void {
    const mtf = new Int32Array(256);
    for (let i = 0; i < 256; ++i)
        mtf[i] = i;
    for (let i = 0; i < vLen; ++i) {
        const index: number = v[i] & 0xFF;
        v[i] = mtf[index];
        if (index !== 0)
            moveToFront(mtf, index);
    }
}
function readHuffmanCodeLengths(codeLengthCodeLengths: Int32Array, numSymbols: number, codeLengths: Int32Array, s: State): number {
    let symbol = 0;
    let prevCodeLen = 8;
    let repeat = 0;
    let repeatCodeLen = 0;
    let space = 32768;
    const table = new Int32Array(33);
    const tableIdx: number = table.length - 1;
    buildHuffmanTable(table, tableIdx, 5, codeLengthCodeLengths, 18);
    while (symbol < numSymbols && space > 0) {
        if (s.halfOffset > 2030) {
            const result: number = readMoreInput(s);
            if (result < 0)
                return result;
        }
        if (s.bitOffset >= 16) {
            s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
            s.bitOffset -= 16;
        }
        const p: number = (s.accumulator32 >>> s.bitOffset) & 31;
        s.bitOffset += table[p] >> 16;
        const codeLen: number = table[p] & 0xFFFF;
        if (codeLen < 16) {
            repeat = 0;
            codeLengths[symbol++] = codeLen;
            if (codeLen !== 0) {
                prevCodeLen = codeLen;
                space -= 32768 >> codeLen;
            }
        }
        else {
            const extraBits: number = codeLen - 14;
            let newLen = 0;
            if (codeLen === 16)
                newLen = prevCodeLen;
            if (repeatCodeLen !== newLen) {
                repeat = 0;
                repeatCodeLen = newLen;
            }
            const oldRepeat: number = repeat;
            if (repeat > 0) {
                repeat -= 2;
                repeat = repeat << extraBits;
            }
            if (s.bitOffset >= 16) {
                s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
                s.bitOffset -= 16;
            }
            repeat += readFewBits(s, extraBits) + 3;
            const repeatDelta: number = repeat - oldRepeat;
            if (symbol + repeatDelta > numSymbols)
                return makeError(s, -2);
            for (let i = 0; i < repeatDelta; ++i)
                codeLengths[symbol++] = repeatCodeLen;
            if (repeatCodeLen !== 0)
                space -= repeatDelta << (15 - repeatCodeLen);
        }
    }
    if (space !== 0)
        return makeError(s, -18);
    codeLengths.fill(0, symbol, numSymbols);
    return 0;
}
function checkDupes(s: State, symbols: Int32Array, length: number): number {
    for (let i = 0; i < length - 1; ++i)
        for (let j: number = i + 1; j < length; ++j)
            if (symbols[i] === symbols[j])
                return makeError(s, -7);
    return 0;
}
function readSimpleHuffmanCode(alphabetSizeMax: number, alphabetSizeLimit: number, tableGroup: Int32Array, tableIdx: number, s: State): number {
    const codeLengths = new Int32Array(alphabetSizeLimit);
    const symbols = new Int32Array(4);
    const maxBits: number = 1 + log2floor(alphabetSizeMax - 1);
    const numSymbols: number = readFewBits(s, 2) + 1;
    for (let i = 0; i < numSymbols; ++i) {
        if (s.bitOffset >= 16) {
            s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
            s.bitOffset -= 16;
        }
        const symbol: number = readFewBits(s, maxBits);
        if (symbol >= alphabetSizeLimit)
            return makeError(s, -15);
        symbols[i] = symbol;
    }
    const result: number = checkDupes(s, symbols, numSymbols);
    if (result < 0)
        return result;
    let histogramId: number = numSymbols;
    if (numSymbols === 4)
        histogramId += readFewBits(s, 1);
    switch (histogramId) {
        case 1:
            codeLengths[symbols[0]] = 1;
            break;
        case 2:
            codeLengths[symbols[0]] = 1;
            codeLengths[symbols[1]] = 1;
            break;
        case 3:
            codeLengths[symbols[0]] = 1;
            codeLengths[symbols[1]] = 2;
            codeLengths[symbols[2]] = 2;
            break;
        case 4:
            codeLengths[symbols[0]] = 2;
            codeLengths[symbols[1]] = 2;
            codeLengths[symbols[2]] = 2;
            codeLengths[symbols[3]] = 2;
            break;
        case 5:
            codeLengths[symbols[0]] = 1;
            codeLengths[symbols[1]] = 2;
            codeLengths[symbols[2]] = 3;
            codeLengths[symbols[3]] = 3;
            break;
        default:
            break;
    }
    return buildHuffmanTable(tableGroup, tableIdx, 8, codeLengths, alphabetSizeLimit);
}
function readComplexHuffmanCode(alphabetSizeLimit: number, skip: number, tableGroup: Int32Array, tableIdx: number, s: State): number {
    const codeLengths = new Int32Array(alphabetSizeLimit);
    const codeLengthCodeLengths = new Int32Array(18);
    let space = 32;
    let numCodes = 0;
    for (let i: number = skip; i < 18; ++i) {
        const codeLenIdx: number = CODE_LENGTH_CODE_ORDER[i];
        if (s.bitOffset >= 16) {
            s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
            s.bitOffset -= 16;
        }
        const p: number = (s.accumulator32 >>> s.bitOffset) & 15;
        s.bitOffset += FIXED_TABLE[p] >> 16;
        const v: number = FIXED_TABLE[p] & 0xFFFF;
        codeLengthCodeLengths[codeLenIdx] = v;
        if (v !== 0) {
            space -= 32 >> v;
            numCodes++;
            if (space <= 0)
                break;
        }
    }
    if (space !== 0 && numCodes !== 1)
        return makeError(s, -4);
    const result: number = readHuffmanCodeLengths(codeLengthCodeLengths, alphabetSizeLimit, codeLengths, s);
    if (result < 0)
        return result;
    return buildHuffmanTable(tableGroup, tableIdx, 8, codeLengths, alphabetSizeLimit);
}
function readHuffmanCode(alphabetSizeMax: number, alphabetSizeLimit: number, tableGroup: Int32Array, tableIdx: number, s: State): number {
    if (s.halfOffset > 2030) {
        const result: number = readMoreInput(s);
        if (result < 0)
            return result;
    }
    if (s.bitOffset >= 16) {
        s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
        s.bitOffset -= 16;
    }
    const simpleCodeOrSkip: number = readFewBits(s, 2);
    if (simpleCodeOrSkip === 1)
        return readSimpleHuffmanCode(alphabetSizeMax, alphabetSizeLimit, tableGroup, tableIdx, s);
    return readComplexHuffmanCode(alphabetSizeLimit, simpleCodeOrSkip, tableGroup, tableIdx, s);
}
function decodeContextMap(contextMapSize: number, contextMap: Int8Array, s: State): number {
    let result: number;
    if (s.halfOffset > 2030) {
        result = readMoreInput(s);
        if (result < 0)
            return result;
    }
    const numTrees: number = decodeVarLenUnsignedByte(s) + 1;
    if (numTrees === 1) {
        contextMap.fill(0, 0, contextMapSize);
        return numTrees;
    }
    if (s.bitOffset >= 16) {
        s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
        s.bitOffset -= 16;
    }
    const useRleForZeros: number = readFewBits(s, 1);
    let maxRunLengthPrefix = 0;
    if (useRleForZeros !== 0)
        maxRunLengthPrefix = readFewBits(s, 4) + 1;
    const alphabetSize: number = numTrees + maxRunLengthPrefix;
    const tableSize: number = MAX_HUFFMAN_TABLE_SIZE[(alphabetSize + 31) >> 5];
    const table = new Int32Array(tableSize + 1);
    const tableIdx: number = table.length - 1;
    result = readHuffmanCode(alphabetSize, alphabetSize, table, tableIdx, s);
    if (result < 0)
        return result;
    let i = 0;
    while (i < contextMapSize) {
        if (s.halfOffset > 2030) {
            result = readMoreInput(s);
            if (result < 0)
                return result;
        }
        if (s.bitOffset >= 16) {
            s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
            s.bitOffset -= 16;
        }
        const code: number = readSymbol(table, tableIdx, s);
        if (code === 0) {
            contextMap[i] = 0;
            i++;
        }
        else if (code <= maxRunLengthPrefix) {
            if (s.bitOffset >= 16) {
                s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
                s.bitOffset -= 16;
            }
            let reps: number = (1 << code) + readFewBits(s, code);
            while (reps !== 0) {
                if (i >= contextMapSize)
                    return makeError(s, -3);
                contextMap[i] = 0;
                i++;
                reps--;
            }
        }
        else {
            contextMap[i] = code - maxRunLengthPrefix;
            i++;
        }
    }
    if (s.bitOffset >= 16) {
        s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
        s.bitOffset -= 16;
    }
    if (readFewBits(s, 1) === 1)
        inverseMoveToFrontTransform(contextMap, contextMapSize);
    return numTrees;
}
function decodeBlockTypeAndLength(s: State, treeType: number, numBlockTypes: number): number {
    const ringBuffers: Int32Array = s.rings;
    const offset: number = 4 + treeType * 2;
    if (s.bitOffset >= 16) {
        s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
        s.bitOffset -= 16;
    }
    let blockType: number = readSymbol(s.blockTrees, 2 * treeType, s);
    const result: number = readBlockLength(s.blockTrees, 2 * treeType + 1, s);
    if (blockType === 1)
        blockType = ringBuffers[offset + 1] + 1;
    else if (blockType === 0)
        blockType = ringBuffers[offset];
    else
        blockType -= 2;
    if (blockType >= numBlockTypes)
        blockType -= numBlockTypes;
    ringBuffers[offset] = ringBuffers[offset + 1];
    ringBuffers[offset + 1] = blockType;
    return result;
}
function decodeLiteralBlockSwitch(s: State): void {
    s.literalBlockLength = decodeBlockTypeAndLength(s, 0, s.numLiteralBlockTypes);
    const literalBlockType: number = s.rings[5];
    s.contextMapSlice = literalBlockType << 6;
    s.literalTreeIdx = s.contextMap[s.contextMapSlice] & 0xFF;
    const contextMode: number = s.contextModes[literalBlockType];
    s.contextLookupOffset1 = contextMode << 9;
    s.contextLookupOffset2 = s.contextLookupOffset1 + 256;
}
function decodeCommandBlockSwitch(s: State): void {
    s.commandBlockLength = decodeBlockTypeAndLength(s, 1, s.numCommandBlockTypes);
    s.commandTreeIdx = s.rings[7];
}
function decodeDistanceBlockSwitch(s: State): void {
    s.distanceBlockLength = decodeBlockTypeAndLength(s, 2, s.numDistanceBlockTypes);
    s.distContextMapSlice = s.rings[9] << 2;
}
function maybeReallocateRingBuffer(s: State): void {
    let newSize: number = s.maxRingBufferSize;
    if (newSize > s.expectedTotalSize) {
        const minimalNewSize: number = s.expectedTotalSize;
        while ((newSize >> 1) > minimalNewSize)
            newSize = newSize >> 1;
        if ((s.inputEnd === 0) && newSize < 16384 && s.maxRingBufferSize >= 16384)
            newSize = 16384;
    }
    if (newSize <= s.ringBufferSize)
        return;
    const ringBufferSizeWithSlack: number = newSize + 37;
    const newBuffer = new Int8Array(ringBufferSizeWithSlack);
    const oldBuffer: Int8Array = s.ringBuffer;
    if (oldBuffer.length !== 0)
        newBuffer.set(oldBuffer.subarray(0, s.ringBufferSize), 0);
    s.ringBuffer = newBuffer;
    s.ringBufferSize = newSize;
}
function readNextMetablockHeader(s: State): number {
    if (s.inputEnd !== 0) {
        s.nextRunningState = 10;
        s.runningState = 12;
        return 0;
    }
    s.literalTreeGroup = new Int32Array(0);
    s.commandTreeGroup = new Int32Array(0);
    s.distanceTreeGroup = new Int32Array(0);
    let result: number;
    if (s.halfOffset > 2030) {
        result = readMoreInput(s);
        if (result < 0)
            return result;
    }
    result = decodeMetaBlockLength(s);
    if (result < 0)
        return result;
    if ((s.metaBlockLength === 0) && (s.isMetadata === 0))
        return 0;
    if ((s.isUncompressed !== 0) || (s.isMetadata !== 0)) {
        result = jumpToByteBoundary(s);
        if (result < 0)
            return result;
        if (s.isMetadata === 0)
            s.runningState = 6;
        else
            s.runningState = 5;
    }
    else
        s.runningState = 3;
    if (s.isMetadata !== 0)
        return 0;
    // Check the declared size before allocating a ring buffer or decoding payload.
    s.declaredOutputSize += s.metaBlockLength;
    if (s.declaredOutputSize > s.maxOutputLength) {
        throw new BrotliDecodeError('Decompressed data exceeds maxOutputLength.', 'OUTPUT_LIMIT', inputPosition(s));
    }
    s.expectedTotalSize += s.metaBlockLength;
    if (s.expectedTotalSize > 1 << 30)
        s.expectedTotalSize = 1 << 30;
    if (s.ringBufferSize < s.maxRingBufferSize)
        maybeReallocateRingBuffer(s);
    return 0;
}
function readMetablockPartition(s: State, treeType: number, numBlockTypes: number): number {
    let offset: number = s.blockTrees[2 * treeType];
    if (numBlockTypes <= 1) {
        s.blockTrees[2 * treeType + 1] = offset;
        s.blockTrees[2 * treeType + 2] = offset;
        return 1 << 28;
    }
    const blockTypeAlphabetSize: number = numBlockTypes + 2;
    let result: number = readHuffmanCode(blockTypeAlphabetSize, blockTypeAlphabetSize, s.blockTrees, 2 * treeType, s);
    if (result < 0)
        return result;
    offset += result;
    s.blockTrees[2 * treeType + 1] = offset;
    const blockLengthAlphabetSize = 26;
    result = readHuffmanCode(blockLengthAlphabetSize, blockLengthAlphabetSize, s.blockTrees, 2 * treeType + 1, s);
    if (result < 0)
        return result;
    offset += result;
    s.blockTrees[2 * treeType + 2] = offset;
    return readBlockLength(s.blockTrees, 2 * treeType + 1, s);
}
function calculateDistanceLut(s: State, alphabetSizeLimit: number): void {
    const distExtraBits: Int8Array = s.distExtraBits;
    const distOffset: Int32Array = s.distOffset;
    const npostfix: number = s.distancePostfixBits;
    const ndirect: number = s.numDirectDistanceCodes;
    const postfix: number = 1 << npostfix;
    let bits = 1;
    let half = 0;
    let i = 16;
    for (let j = 0; j < ndirect; ++j) {
        distExtraBits[i] = 0;
        distOffset[i] = j + 1;
        ++i;
    }
    while (i < alphabetSizeLimit) {
        const base: number = ndirect + ((((2 + half) << bits) - 4) << npostfix) + 1;
        for (let j = 0; j < postfix; ++j) {
            distExtraBits[i] = bits;
            distOffset[i] = base + j;
            ++i;
        }
        bits = bits + half;
        half = half ^ 1;
    }
}
function readMetablockHuffmanCodesAndContextMaps(s: State): number {
    s.numLiteralBlockTypes = decodeVarLenUnsignedByte(s) + 1;
    let result: number = readMetablockPartition(s, 0, s.numLiteralBlockTypes);
    if (result < 0)
        return result;
    s.literalBlockLength = result;
    s.numCommandBlockTypes = decodeVarLenUnsignedByte(s) + 1;
    result = readMetablockPartition(s, 1, s.numCommandBlockTypes);
    if (result < 0)
        return result;
    s.commandBlockLength = result;
    s.numDistanceBlockTypes = decodeVarLenUnsignedByte(s) + 1;
    result = readMetablockPartition(s, 2, s.numDistanceBlockTypes);
    if (result < 0)
        return result;
    s.distanceBlockLength = result;
    if (s.halfOffset > 2030) {
        result = readMoreInput(s);
        if (result < 0)
            return result;
    }
    if (s.bitOffset >= 16) {
        s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
        s.bitOffset -= 16;
    }
    s.distancePostfixBits = readFewBits(s, 2);
    s.numDirectDistanceCodes = readFewBits(s, 4) << s.distancePostfixBits;
    s.contextModes = new Int8Array(s.numLiteralBlockTypes);
    let i = 0;
    while (i < s.numLiteralBlockTypes) {
        const limit: number = Math.min(i + 96, s.numLiteralBlockTypes);
        while (i < limit) {
            if (s.bitOffset >= 16) {
                s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
                s.bitOffset -= 16;
            }
            s.contextModes[i] = readFewBits(s, 2);
            i++;
        }
        if (s.halfOffset > 2030) {
            result = readMoreInput(s);
            if (result < 0)
                return result;
        }
    }
    const contextMapLength: number = s.numLiteralBlockTypes << 6;
    s.contextMap = new Int8Array(contextMapLength);
    result = decodeContextMap(contextMapLength, s.contextMap, s);
    if (result < 0)
        return result;
    const numLiteralTrees: number = result;
    s.trivialLiteralContext = 1;
    for (let j = 0; j < contextMapLength; ++j)
        if (s.contextMap[j] !== j >> 6) {
            s.trivialLiteralContext = 0;
            break;
        }
    s.distContextMap = new Int8Array(s.numDistanceBlockTypes << 2);
    result = decodeContextMap(s.numDistanceBlockTypes << 2, s.distContextMap, s);
    if (result < 0)
        return result;
    const numDistTrees: number = result;
    s.literalTreeGroup = new Int32Array(huffmanTreeGroupAllocSize(256, numLiteralTrees));
    result = decodeHuffmanTreeGroup(256, 256, numLiteralTrees, s, s.literalTreeGroup);
    if (result < 0)
        return result;
    s.commandTreeGroup = new Int32Array(huffmanTreeGroupAllocSize(704, s.numCommandBlockTypes));
    result = decodeHuffmanTreeGroup(704, 704, s.numCommandBlockTypes, s, s.commandTreeGroup);
    if (result < 0)
        return result;
    let distanceAlphabetSizeMax: number = calculateDistanceAlphabetSize(s.distancePostfixBits, s.numDirectDistanceCodes, 24);
    let distanceAlphabetSizeLimit: number = distanceAlphabetSizeMax;

    s.distanceTreeGroup = new Int32Array(huffmanTreeGroupAllocSize(distanceAlphabetSizeLimit, numDistTrees));
    result = decodeHuffmanTreeGroup(distanceAlphabetSizeMax, distanceAlphabetSizeLimit, numDistTrees, s, s.distanceTreeGroup);
    if (result < 0)
        return result;
    calculateDistanceLut(s, distanceAlphabetSizeLimit);
    s.contextMapSlice = 0;
    s.distContextMapSlice = 0;
    s.contextLookupOffset1 = s.contextModes[0] * 512;
    s.contextLookupOffset2 = s.contextLookupOffset1 + 256;
    s.literalTreeIdx = 0;
    s.commandTreeIdx = 0;
    s.rings[4] = 1;
    s.rings[5] = 0;
    s.rings[6] = 1;
    s.rings[7] = 0;
    s.rings[8] = 1;
    s.rings[9] = 0;
    return 0;
}
function copyUncompressedData(s: State): number {
    const ringBuffer: Int8Array = s.ringBuffer;
    let result: number;
    if (s.metaBlockLength <= 0) {
        result = reload(s);
        if (result < 0)
            return result;
        s.runningState = 2;
        return 0;
    }
    const chunkLength: number = Math.min(s.ringBufferSize - s.pos, s.metaBlockLength);
    result = copyRawBytes(s, ringBuffer, s.pos, chunkLength);
    if (result < 0)
        return result;
    s.metaBlockLength -= chunkLength;
    s.pos += chunkLength;
    if (s.pos === s.ringBufferSize) {
        s.nextRunningState = 6;
        s.runningState = 12;
        return 0;
    }
    result = reload(s);
    if (result < 0)
        return result;
    s.runningState = 2;
    return 0;
}
function writeRingBuffer(s: State): number {
    const toWrite: number = Math.min(s.outputLength - s.outputUsed, s.ringBufferBytesReady - s.ringBufferBytesWritten);
    if (toWrite !== 0) {
        s.output.set(s.ringBuffer.subarray(s.ringBufferBytesWritten, s.ringBufferBytesWritten + toWrite), s.outputOffset + s.outputUsed);
        s.outputUsed += toWrite;
        s.ringBufferBytesWritten += toWrite;
    }
    if (s.outputUsed < s.outputLength)
        return 0;
    return 2;
}
function huffmanTreeGroupAllocSize(alphabetSizeLimit: number, n: number): number {
    const maxTableSize: number = MAX_HUFFMAN_TABLE_SIZE[(alphabetSizeLimit + 31) >> 5];
    return n + n * maxTableSize;
}
function decodeHuffmanTreeGroup(alphabetSizeMax: number, alphabetSizeLimit: number, n: number, s: State, group: Int32Array): number {
    let next: number = n;
    for (let i = 0; i < n; ++i) {
        group[i] = next;
        const result: number = readHuffmanCode(alphabetSizeMax, alphabetSizeLimit, group, i, s);
        if (result < 0)
            return result;
        next += result;
    }
    return 0;
}

function doUseDictionary(s: State, fence: number): number {
    if (s.distance > 0x7FFFFFFC)
        return makeError(s, -9);
    const address: number = s.distance - s.maxDistance - 1;
    {
        const dictionaryData: Int8Array = data;
        const wordLength: number = s.copyLength;
        if (wordLength > 31)
            return makeError(s, -9);
        const shift: number = sizeBits[wordLength];
        if (shift === 0)
            return makeError(s, -9);
        let offset: number = offsets[wordLength];
        const mask: number = (1 << shift) - 1;
        const wordIdx: number = address & mask;
        const transformIdx: number = address >> shift;
        offset += wordIdx * wordLength;
        const transforms: Transforms = RFC_TRANSFORMS;
        if (transformIdx >= transforms.numTransforms)
            return makeError(s, -9);
        const len: number = transformDictionaryWord(s.ringBuffer, s.pos, dictionaryData, offset, wordLength, transforms, transformIdx);
        s.pos += len;
        s.metaBlockLength -= len;
        if (s.pos >= fence) {
            s.nextRunningState = 4;
            s.runningState = 12;
            return 0;
        }
        s.runningState = 4;
    }
    return 0;
}
function decompress(s: State): number {
    let result: number;
    if (s.runningState === 0)
        return makeError(s, -25);
    if (s.runningState < 0)
        return makeError(s, -28);
    if (s.runningState === 11)
        return makeError(s, -22);
    if (s.runningState === 1) {
        const windowBits: number = decodeWindowBits(s);
        if (windowBits === -1)
            return makeError(s, -11);
        s.maxRingBufferSize = 1 << windowBits;
        s.maxBackwardDistance = s.maxRingBufferSize - 16;
        s.runningState = 2;
    }
    let fence: number = s.ringBufferSize;
    let ringBufferMask: number = s.ringBufferSize - 1;
    let ringBuffer: Int8Array = s.ringBuffer;
    while (s.runningState !== 10)
        switch (s.runningState) {
            case 2:
                if (s.metaBlockLength < 0)
                    return makeError(s, -10);
                result = readNextMetablockHeader(s);
                if (result < 0)
                    return result;
                fence = s.ringBufferSize;
                ringBufferMask = s.ringBufferSize - 1;
                ringBuffer = s.ringBuffer;
                continue;
            case 3:
                result = readMetablockHuffmanCodesAndContextMaps(s);
                if (result < 0)
                    return result;
                s.runningState = 4;
                continue;
            case 4:
                if (s.metaBlockLength <= 0) {
                    s.runningState = 2;
                    continue;
                }
                if (s.halfOffset > 2030) {
                    result = readMoreInput(s);
                    if (result < 0)
                        return result;
                }
                if (s.commandBlockLength === 0)
                    decodeCommandBlockSwitch(s);
                s.commandBlockLength--;
                if (s.bitOffset >= 16) {
                    s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
                    s.bitOffset -= 16;
                }
                const cmdCode: number = readSymbol(s.commandTreeGroup, s.commandTreeIdx, s) << 2;
                const insertAndCopyExtraBits: number = CMD_LOOKUP[cmdCode];
                const insertLengthOffset: number = CMD_LOOKUP[cmdCode + 1];
                const copyLengthOffset: number = CMD_LOOKUP[cmdCode + 2];
                s.distanceCode = CMD_LOOKUP[cmdCode + 3];
                if (s.bitOffset >= 16) {
                    s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
                    s.bitOffset -= 16;
                }
                const insertLengthExtraBits: number = insertAndCopyExtraBits & 0xFF;
                s.insertLength = insertLengthOffset + ((insertLengthExtraBits <= 16) ? readFewBits(s, insertLengthExtraBits) : readManyBits(s, insertLengthExtraBits));
                if (s.bitOffset >= 16) {
                    s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
                    s.bitOffset -= 16;
                }
                const copyLengthExtraBits: number = insertAndCopyExtraBits >> 8;
                s.copyLength = copyLengthOffset + ((copyLengthExtraBits <= 16) ? readFewBits(s, copyLengthExtraBits) : readManyBits(s, copyLengthExtraBits));
                if (s.insertLength > s.metaBlockLength) return makeError(s, -10);
                s.j = 0;
                s.runningState = 7;
                continue;
            case 7:
                if (s.trivialLiteralContext !== 0)
                    while (s.j < s.insertLength) {
                        if (s.halfOffset > 2030) {
                            result = readMoreInput(s);
                            if (result < 0)
                                return result;
                        }
                        if (s.literalBlockLength === 0)
                            decodeLiteralBlockSwitch(s);
                        s.literalBlockLength--;
                        if (s.bitOffset >= 16) {
                            s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
                            s.bitOffset -= 16;
                        }
                        ringBuffer[s.pos] = readSymbol(s.literalTreeGroup, s.literalTreeIdx, s);
                        s.pos++;
                        s.j++;
                        if (s.pos >= fence) {
                            s.nextRunningState = 7;
                            s.runningState = 12;
                            break;
                        }
                    }
                else {
                    let prevByte1: number = ringBuffer[(s.pos - 1) & ringBufferMask] & 0xFF;
                    let prevByte2: number = ringBuffer[(s.pos - 2) & ringBufferMask] & 0xFF;
                    while (s.j < s.insertLength) {
                        if (s.halfOffset > 2030) {
                            result = readMoreInput(s);
                            if (result < 0)
                                return result;
                        }
                        if (s.literalBlockLength === 0)
                            decodeLiteralBlockSwitch(s);
                        const literalContext: number = LOOKUP[s.contextLookupOffset1 + prevByte1] | LOOKUP[s.contextLookupOffset2 + prevByte2];
                        const literalTreeIdx: number = s.contextMap[s.contextMapSlice + literalContext] & 0xFF;
                        s.literalBlockLength--;
                        prevByte2 = prevByte1;
                        if (s.bitOffset >= 16) {
                            s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
                            s.bitOffset -= 16;
                        }
                        prevByte1 = readSymbol(s.literalTreeGroup, literalTreeIdx, s);
                        ringBuffer[s.pos] = prevByte1;
                        s.pos++;
                        s.j++;
                        if (s.pos >= fence) {
                            s.nextRunningState = 7;
                            s.runningState = 12;
                            break;
                        }
                    }
                }
                if (s.runningState !== 7)
                    continue;
                s.metaBlockLength -= s.insertLength;
                if (s.metaBlockLength <= 0) {
                    s.runningState = 4;
                    continue;
                }
                let distanceCode: number = s.distanceCode;
                if (distanceCode < 0)
                    s.distance = s.rings[s.distRbIdx];
                else {
                    if (s.halfOffset > 2030) {
                        result = readMoreInput(s);
                        if (result < 0)
                            return result;
                    }
                    if (s.distanceBlockLength === 0)
                        decodeDistanceBlockSwitch(s);
                    s.distanceBlockLength--;
                    if (s.bitOffset >= 16) {
                        s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
                        s.bitOffset -= 16;
                    }
                    const distTreeIdx: number = s.distContextMap[s.distContextMapSlice + distanceCode] & 0xFF;
                    distanceCode = readSymbol(s.distanceTreeGroup, distTreeIdx, s);
                    if (distanceCode < 16) {
                        const index: number = (s.distRbIdx + DISTANCE_SHORT_CODE_INDEX_OFFSET[distanceCode]) & 0x3;
                        s.distance = s.rings[index] + DISTANCE_SHORT_CODE_VALUE_OFFSET[distanceCode];
                        if (s.distance <= 0)
                            return makeError(s, -12);
                    }
                    else {
                        const extraBits: number = s.distExtraBits[distanceCode];
                        let bits: number;
                        if (s.bitOffset + extraBits <= 32)
                            bits = readFewBits(s, extraBits);
                        else {
                            if (s.bitOffset >= 16) {
                                s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
                                s.bitOffset -= 16;
                            }
                            bits = (extraBits <= 16) ? readFewBits(s, extraBits) : readManyBits(s, extraBits);
                        }
                        s.distance = s.distOffset[distanceCode] + (bits << s.distancePostfixBits);
                    }
                }
                if (s.maxDistance !== s.maxBackwardDistance && s.pos < s.maxBackwardDistance)
                    s.maxDistance = s.pos;
                else
                    s.maxDistance = s.maxBackwardDistance;
                if (s.distance > s.maxDistance) {
                    s.runningState = 9;
                    continue;
                }
                if (distanceCode > 0) {
                    s.distRbIdx = (s.distRbIdx + 1) & 0x3;
                    s.rings[s.distRbIdx] = s.distance;
                }
                if (s.copyLength > s.metaBlockLength)
                    return makeError(s, -9);
                s.j = 0;
                s.runningState = 8;
                continue;
            case 8:
                let src: number = (s.pos - s.distance) & ringBufferMask;
                let dst: number = s.pos;
                const copyLength: number = s.copyLength - s.j;
                const srcEnd: number = src + copyLength;
                const dstEnd: number = dst + copyLength;
                if ((srcEnd < ringBufferMask) && (dstEnd < ringBufferMask)) {
                    if (copyLength < 12 || (srcEnd > dst && dstEnd > src)) {
                        const numQuads: number = (copyLength + 3) >> 2;
                        for (let k = 0; k < numQuads; ++k) {
                            ringBuffer[dst++] = ringBuffer[src++];
                            ringBuffer[dst++] = ringBuffer[src++];
                            ringBuffer[dst++] = ringBuffer[src++];
                            ringBuffer[dst++] = ringBuffer[src++];
                        }
                    }
                    else
                        ringBuffer.copyWithin(dst, src, srcEnd);
                    s.j += copyLength;
                    s.metaBlockLength -= copyLength;
                    s.pos += copyLength;
                }
                else
                    while (s.j < s.copyLength) {
                        ringBuffer[s.pos] = ringBuffer[(s.pos - s.distance) & ringBufferMask];
                        s.metaBlockLength--;
                        s.pos++;
                        s.j++;
                        if (s.pos >= fence) {
                            s.nextRunningState = 8;
                            s.runningState = 12;
                            break;
                        }
                    }
                if (s.runningState === 8)
                    s.runningState = 4;
                continue;
            case 9:
                result = doUseDictionary(s, fence);
                if (result < 0)
                    return result;
                continue;
            case 5:
                while (s.metaBlockLength > 0) {
                    if (s.halfOffset > 2030) {
                        result = readMoreInput(s);
                        if (result < 0)
                            return result;
                    }
                    if (s.bitOffset >= 16) {
                        s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
                        s.bitOffset -= 16;
                    }
                    readFewBits(s, 8);
                    s.metaBlockLength--;
                }
                s.runningState = 2;
                continue;
            case 6:
                result = copyUncompressedData(s);
                if (result < 0)
                    return result;
                continue;
            case 12:
                s.ringBufferBytesReady = Math.min(s.pos, s.ringBufferSize);
                s.runningState = 13;
                continue;
            case 13:
                result = writeRingBuffer(s);
                if (result !== 0)
                    return result;
                if (s.pos >= s.maxBackwardDistance)
                    s.maxDistance = s.maxBackwardDistance;
                if (s.pos >= s.ringBufferSize) {
                    if (s.pos > s.ringBufferSize)
                        ringBuffer.copyWithin(0, s.ringBufferSize, s.pos);
                    s.pos = s.pos & ringBufferMask;
                    s.ringBufferBytesWritten = 0;
                }
                s.runningState = s.nextRunningState;
                continue;
            default:
                return makeError(s, -28);
        }
    if (s.runningState !== 10)
        return makeError(s, -29);
    if (s.metaBlockLength < 0)
        return makeError(s, -10);
    result = jumpToByteBoundary(s);
    if (result !== 0)
        return result;
    result = checkHealth(s, 1);
    if (result !== 0)
        return result;
    return 1;
}
class Transforms {
    numTransforms = 0;
    triplets = new Int32Array(0);
    prefixSuffixStorage = new Int8Array(0);
    prefixSuffixHeads = new Int32Array(0);
    constructor(numTransforms: number, prefixSuffixLen: number, prefixSuffixCount: number) {
        this.numTransforms = numTransforms;
        this.triplets = new Int32Array(numTransforms * 3);
        this.prefixSuffixStorage = new Int8Array(prefixSuffixLen);
        this.prefixSuffixHeads = new Int32Array(prefixSuffixCount + 1);
    }
}
const RFC_TRANSFORMS = new Transforms(121, 167, 50);
function unpackTransforms(prefixSuffix: Int8Array, prefixSuffixHeads: Int32Array, transforms: Int32Array, prefixSuffixSrc: string, transformsSrc: string): void {
    const prefixSuffixBytes: Int32Array = toUtf8Runes(prefixSuffixSrc);
    const n: number = prefixSuffixBytes.length;
    let index = 1;
    let j = 0;
    for (let i = 0; i < n; ++i) {
        const c: number = prefixSuffixBytes[i];
        if (c === 35)
            prefixSuffixHeads[index++] = j;
        else
            prefixSuffix[j++] = c;
    }
    for (let i = 0; i < 363; ++i)
        transforms[i] = transformsSrc.charCodeAt(i) - 32;
}
{
    // typo:off
    unpackTransforms(RFC_TRANSFORMS.prefixSuffixStorage, RFC_TRANSFORMS.prefixSuffixHeads, RFC_TRANSFORMS.triplets, "# #s #, #e #.# the #.com/#\xC2\xA0# of # and # in # to #\"#\">#\n#]# for # a # that #. # with #'# from # by #. The # on # as # is #ing #\n\t#:#ed #(# at #ly #=\"# of the #. This #,# not #er #al #='#ful #ive #less #est #ize #ous #", "     !! ! ,  *!  &!  \" !  ) *   * -  ! # !  #!*!  +  ,$ !  -  %  .  / #   0  1 .  \"   2  3!*   4%  ! # /   5  6  7  8 0  1 &   $   9 +   :  ;  < '  !=  >  ?! 4  @ 4  2  &   A *# (   B  C& ) %  ) !*# *-% A +! *.  D! %'  & E *6  F  G% ! *A *%  H! D  I!+!  J!+   K +- *4! A  L!*4  M  N +6  O!*% +.! K *G  P +%(  ! G *D +D  Q +# *K!*G!+D!+# +G +A +4!+% +K!+4!*D!+K!*K");
    // typo:on
}
function transformDictionaryWord(dst: Int8Array, dstOffset: number, src: Int8Array, srcOffset: number, wordLen: number, transforms: Transforms, transformIndex: number): number {
    let offset: number = dstOffset;
    const triplets: Int32Array = transforms.triplets;
    const prefixSuffixStorage: Int8Array = transforms.prefixSuffixStorage;
    const prefixSuffixHeads: Int32Array = transforms.prefixSuffixHeads;
    const transformOffset: number = 3 * transformIndex;
    const prefixIdx: number = triplets[transformOffset];
    const transformType: number = triplets[transformOffset + 1];
    const suffixIdx: number = triplets[transformOffset + 2];
    let prefix: number = prefixSuffixHeads[prefixIdx];
    const prefixEnd: number = prefixSuffixHeads[prefixIdx + 1];
    let suffix: number = prefixSuffixHeads[suffixIdx];
    const suffixEnd: number = prefixSuffixHeads[suffixIdx + 1];
    let omitFirst: number = transformType - 11;
    let omitLast: number = transformType;
    if (omitFirst < 1 || omitFirst > 9)
        omitFirst = 0;
    if (omitLast < 1 || omitLast > 9)
        omitLast = 0;
    while (prefix !== prefixEnd)
        dst[offset++] = prefixSuffixStorage[prefix++];
    let len: number = wordLen;
    if (omitFirst > len)
        omitFirst = len;
    let dictOffset: number = srcOffset + omitFirst;
    len -= omitFirst;
    len -= omitLast;
    let i: number = len;
    while (i > 0) {
        dst[offset++] = src[dictOffset++];
        i--;
    }
    if (transformType === 10 || transformType === 11) {
        let uppercaseOffset: number = offset - len;
        if (transformType === 10)
            len = 1;
        while (len > 0) {
            const c0: number = dst[uppercaseOffset] & 0xFF;
            if (c0 < 0xC0) {
                if (c0 >= 97 && c0 <= 122)
                    dst[uppercaseOffset] = dst[uppercaseOffset] ^ 32;
                uppercaseOffset += 1;
                len -= 1;
            }
            else if (c0 < 0xE0) {
                dst[uppercaseOffset + 1] = dst[uppercaseOffset + 1] ^ 32;
                uppercaseOffset += 2;
                len -= 2;
            }
            else {
                dst[uppercaseOffset + 2] = dst[uppercaseOffset + 2] ^ 5;
                uppercaseOffset += 3;
                len -= 3;
            }
        }
    }
    while (suffix !== suffixEnd)
        dst[offset++] = prefixSuffixStorage[suffix++];
    return offset - dstOffset;
}
function getNextKey(key: number, len: number): number {
    let step: number = 1 << (len - 1);
    while ((key & step) !== 0)
        step = step >> 1;
    return (key & (step - 1)) + step;
}
function replicateValue(table: Int32Array, offset: number, step: number, end: number, item: number): void {
    let pos: number = end;
    while (pos > 0) {
        pos -= step;
        table[offset + pos] = item;
    }
}
function nextTableBitSize(count: Int32Array, len: number, rootBits: number): number {
    let bits: number = len;
    let left: number = 1 << (bits - rootBits);
    while (bits < 15) {
        left -= count[bits];
        if (left <= 0)
            break;
        bits++;
        left = left << 1;
    }
    return bits - rootBits;
}
function buildHuffmanTable(tableGroup: Int32Array, tableIdx: number, rootBits: number, codeLengths: Int32Array, codeLengthsSize: number): number {
    const tableOffset: number = tableGroup[tableIdx];
    const sorted = new Int32Array(codeLengthsSize);
    const count = new Int32Array(16);
    const offset = new Int32Array(16);
    for (let sym = 0; sym < codeLengthsSize; ++sym) {
        count[codeLengths[sym]]++;
    }
    offset[1] = 0;
    for (let len = 1; len < 15; ++len)
        offset[len + 1] = offset[len] + count[len];
    for (let sym = 0; sym < codeLengthsSize; ++sym)
        if (codeLengths[sym] !== 0)
            sorted[offset[codeLengths[sym]]++] = sym;
    let tableBits: number = rootBits;
    let tableSize: number = 1 << tableBits;
    let totalSize: number = tableSize;
    if (offset[15] === 1) {
        for (let k = 0; k < totalSize; ++k)
            tableGroup[tableOffset + k] = sorted[0];
        return totalSize;
    }
    let key = 0;
    let symbol = 0;
    let step = 1;
    for (let len = 1; len <= rootBits; ++len) {
        step = step << 1;
        while (count[len] > 0) {
            replicateValue(tableGroup, tableOffset + key, step, tableSize, len << 16 | sorted[symbol++]);
            key = getNextKey(key, len);
            count[len]--;
        }
    }
    const mask: number = totalSize - 1;
    let low: number = -1;
    let currentOffset: number = tableOffset;
    step = 1;
    for (let len: number = rootBits + 1; len <= 15; ++len) {
        step = step << 1;
        while (count[len] > 0) {
            if ((key & mask) !== low) {
                currentOffset += tableSize;
                tableBits = nextTableBitSize(count, len, rootBits);
                tableSize = 1 << tableBits;
                totalSize += tableSize;
                low = key & mask;
                tableGroup[tableOffset + low] = (tableBits + rootBits) << 16 | (currentOffset - tableOffset - low);
            }
            replicateValue(tableGroup, currentOffset + (key >> rootBits), step, tableSize, (len - rootBits) << 16 | sorted[symbol++]);
            key = getNextKey(key, len);
            count[len]--;
        }
    }
    return totalSize;
}
function readMoreInput(s: State): number {
    if (s.endOfStreamReached !== 0) {
        if (halfAvailable(s) >= -2)
            return 0;
        return makeError(s, -16);
    }
    const readOffset: number = s.halfOffset << 1;
    let bytesInBuffer: number = 4096 - readOffset;
    s.byteBuffer.copyWithin(0, readOffset, 4096);
    s.halfOffset = 0;
    while (bytesInBuffer < 4096) {
        const spaceLeft: number = 4096 - bytesInBuffer;
        const len: number = readInput(s, s.byteBuffer, bytesInBuffer, spaceLeft);
        if (len < -1)
            return len;
        if (len <= 0) {
            s.endOfStreamReached = 1;
            s.tailBytes = bytesInBuffer;
            // A refill must not leave bytes from the preceding block in lookahead.
            s.byteBuffer.fill(0, bytesInBuffer);
            s.shortBuffer.fill(0, bytesInBuffer >> 1);
            bytesInBuffer += 1;
            break;
        }
        bytesInBuffer += len;
    }
    bytesToNibbles(s, bytesInBuffer);
    return 0;
}
/** Absolute consumed bytes, including buffered lookahead and direct raw copies. */
function inputPosition(s: State): number {
    const bufferedBytes = s.endOfStreamReached ? s.tailBytes : 4096;
    const byteOffset = (s.halfOffset * 2) + Math.ceil(s.bitOffset / 8) - 4;
    return s.input.offset - bufferedBytes + byteOffset;
}
function checkHealth(s: State, endOfStream: number): number {
    const consumed = inputPosition(s);
    if (consumed > s.input.data.length) return makeError(s, -13);
    // The upstream streaming check only rejects trailing bytes once EOF is read.
    // With an in-memory input we can check even when a full refill hid EOF.
    if (endOfStream !== 0 && consumed !== s.input.data.length) return makeError(s, -17);
    return 0;
}
function readFewBits(s: State, n: number): number {
    const v: number = (s.accumulator32 >>> s.bitOffset) & ((1 << n) - 1);
    s.bitOffset += n;
    return v;
}
function readManyBits(s: State, n: number): number {
    const low: number = readFewBits(s, 16);
    s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
    s.bitOffset -= 16;
    return low | (readFewBits(s, n - 16) << 16);
}
function initBitReader(s: State): number {
    s.byteBuffer = new Int8Array(4160);
    s.accumulator32 = 0;
    s.shortBuffer = new Int16Array(2080);
    s.bitOffset = 32;
    s.halfOffset = 2048;
    s.endOfStreamReached = 0;
    return prepare(s);
}
function prepare(s: State): number {
    if (s.halfOffset > 2030) {
        const result: number = readMoreInput(s);
        if (result !== 0)
            return result;
    }
    let health: number = checkHealth(s, 0);
    if (health !== 0)
        return health;
    s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
    s.bitOffset -= 16;
    s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
    s.bitOffset -= 16;
    return 0;
}
function reload(s: State): number {
    if (s.bitOffset === 32)
        return prepare(s);
    return 0;
}
function jumpToByteBoundary(s: State): number {
    const padding: number = (32 - s.bitOffset) & 7;
    if (padding !== 0) {
        const paddingBits: number = readFewBits(s, padding);
        if (paddingBits !== 0)
            return makeError(s, -5);
    }
    return 0;
}
function halfAvailable(s: State): number {
    let limit = 2048;
    if (s.endOfStreamReached !== 0)
        limit = (s.tailBytes + 1) >> 1;
    return limit - s.halfOffset;
}
function copyRawBytes(s: State, data: Int8Array, offset: number, length: number): number {
    let pos: number = offset;
    let len: number = length;
    if ((s.bitOffset & 7) !== 0)
        return makeError(s, -30);
    while ((s.bitOffset !== 32) && (len !== 0)) {
        data[pos++] = s.accumulator32 >>> s.bitOffset;
        s.bitOffset += 8;
        len--;
    }
    if (len === 0)
        return 0;
    const copyNibbles: number = Math.min(halfAvailable(s), len >> 1);
    if (copyNibbles > 0) {
        const readOffset: number = s.halfOffset << 1;
        const delta: number = copyNibbles << 1;
        data.set(s.byteBuffer.subarray(readOffset, readOffset + delta), pos);
        pos += delta;
        len -= delta;
        s.halfOffset += copyNibbles;
    }
    if (len === 0)
        return 0;
    if (halfAvailable(s) > 0) {
        if (s.bitOffset >= 16) {
            s.accumulator32 = (s.shortBuffer[s.halfOffset++] << 16) | (s.accumulator32 >>> 16);
            s.bitOffset -= 16;
        }
        while (len !== 0) {
            data[pos++] = s.accumulator32 >>> s.bitOffset;
            s.bitOffset += 8;
            len--;
        }
        return checkHealth(s, 0);
    }
    while (len > 0) {
        const chunkLen: number = readInput(s, data, pos, len);
        if (chunkLen < -1)
            return chunkLen;
        if (chunkLen <= 0)
            return makeError(s, -16);
        pos += chunkLen;
        len -= chunkLen;
    }
    return 0;
}
function bytesToNibbles(s: State, byteLen: number): void {
    const byteBuffer: Int8Array = s.byteBuffer;
    const halfLen: number = byteLen >> 1;
    const shortBuffer: Int16Array = s.shortBuffer;
    for (let i = 0; i < halfLen; ++i)
        shortBuffer[i] = (byteBuffer[i * 2] & 0xFF) | ((byteBuffer[(i * 2) + 1] & 0xFF) << 8);
}
const LOOKUP = new Int32Array(2048);
function unpackLookupTable(lookup: Int32Array, utfMap: string, utfRle: string): void {
    for (let i = 0; i < 256; ++i) {
        lookup[i] = i & 0x3F;
        lookup[512 + i] = i >> 2;
        lookup[1792 + i] = 2 + (i >> 6);
    }
    for (let i = 0; i < 128; ++i)
        lookup[1024 + i] = 4 * (utfMap.charCodeAt(i) - 32);
    for (let i = 0; i < 64; ++i) {
        lookup[1152 + i] = i & 1;
        lookup[1216 + i] = 2 + (i & 1);
    }
    let offset = 1280;
    for (let k = 0; k < 19; ++k) {
        const value: number = k & 3;
        const rep: number = utfRle.charCodeAt(k) - 32;
        for (let i = 0; i < rep; ++i)
            lookup[offset++] = value;
    }
    for (let i = 0; i < 16; ++i) {
        lookup[1792 + i] = 1;
        lookup[2032 + i] = 6;
    }
    lookup[1792] = 0;
    lookup[2047] = 7;
    for (let i = 0; i < 256; ++i)
        lookup[1536 + i] = lookup[1792 + i] << 3;
}
{
    unpackLookupTable(LOOKUP, "         !!  !                  \"#$##%#$&'##(#)#++++++++++((&*'##,---,---,-----,-----,-----&#'###.///.///./////./////./////&#'# ", "A/*  ':  & : $  \x81 @");
}
/** Per-call state. Numeric states follow the reference decoder:
 * 1: initialize, 2: meta-block header, 3: trees/context maps, 4: command,
 * 5: metadata, 6: raw bytes, 7: literals, 8: history copy, 9: dictionary,
 * 10: done, 12: prepare output and 13: drain output. Negative values are errors.
 */
class State {
    ringBuffer = new Int8Array(0);
    contextModes = new Int8Array(0);
    contextMap = new Int8Array(0);
    distContextMap = new Int8Array(0);
    distExtraBits = new Int8Array(0);
    output = new Int8Array(0);
    byteBuffer = new Int8Array(0);
    shortBuffer = new Int16Array(0);
    rings = new Int32Array(0);
    blockTrees = new Int32Array(0);
    literalTreeGroup = new Int32Array(0);
    commandTreeGroup = new Int32Array(0);
    distanceTreeGroup = new Int32Array(0);
    distOffset = new Int32Array(0);
    runningState = 0;
    nextRunningState = 0;
    accumulator32 = 0;
    bitOffset = 0;
    halfOffset = 0;
    tailBytes = 0;
    endOfStreamReached = 0;
    metaBlockLength = 0;
    inputEnd = 0;
    isUncompressed = 0;
    isMetadata = 0;
    literalBlockLength = 0;
    numLiteralBlockTypes = 0;
    commandBlockLength = 0;
    numCommandBlockTypes = 0;
    distanceBlockLength = 0;
    numDistanceBlockTypes = 0;
    pos = 0;
    maxDistance = 0;
    distRbIdx = 0;
    trivialLiteralContext = 0;
    literalTreeIdx = 0;
    commandTreeIdx = 0;
    j = 0;
    insertLength = 0;
    contextMapSlice = 0;
    distContextMapSlice = 0;
    contextLookupOffset1 = 0;
    contextLookupOffset2 = 0;
    distanceCode = 0;
    numDirectDistanceCodes = 0;
    distancePostfixBits = 0;
    distance = 0;
    copyLength = 0;
    maxBackwardDistance = 0;
    maxRingBufferSize = 0;
    ringBufferSize = 0;
    expectedTotalSize = 0;
    declaredOutputSize = 0;
    maxOutputLength = 0;
    outputOffset = 0;
    outputLength = 0;
    outputUsed = 0;
    ringBufferBytesWritten = 0;
    ringBufferBytesReady = 0;
    input = new InputStream(new Int8Array(0));
    constructor() {
        this.ringBuffer = new Int8Array(0);
        this.rings = new Int32Array(10);
        this.rings[0] = 16;
        this.rings[1] = 15;
        this.rings[2] = 11;
        this.rings[3] = 4;
    }
}
class InputStream {
    data: Int8Array;
    offset = 0;
    constructor(data: Int8Array) { this.data = data; }
}
function readInput(s: State, dst: Int8Array, offset: number, length: number): number {
    if (s.input === null)
        return -1;
    const src: InputStream = s.input;
    const end: number = Math.min(src.offset + length, src.data.length);
    const bytesRead: number = end - src.offset;
    dst.set(src.data.subarray(src.offset, end), offset);
    src.offset += bytesRead;
    return bytesRead;
}
function toUtf8Runes(src: string): Int32Array {
    const n: number = src.length;
    const result = new Int32Array(n);
    for (let i = 0; i < n; ++i)
        result[i] = src.charCodeAt(i);
    return result;
}
function makeError(s: State, code: number): number {
    if (code >= 0)
        return code;
    if (s.runningState >= 0)
        s.runningState = code;
    const category = code === -13 || code === -16 ? 'UNEXPECTED_EOF' : code === -17 ? 'TRAILING_DATA' : 'INVALID_DATA';
    throw new BrotliDecodeError(decoderMessages[code] ?? 'Invalid Brotli decoder state.', category, Math.max(0, inputPosition(s)), code);
}



/** Internal one-shot driver. The core uses a ring buffer, not a public streaming API. */
export function decode(bytes: Int8Array, maxOutputLength: number): Uint8Array<ArrayBuffer> {
    if (bytes.length === 0) throw new BrotliDecodeError('Unexpected end of Brotli input.', 'UNEXPECTED_EOF', 0, -16);
    const state = new State();
    state.input = new InputStream(bytes);
    state.maxOutputLength = maxOutputLength;
    initState(state);
    const chunks: Int8Array[] = [];
    let totalOutput = 0;
    while (true) {
        // A one-byte scratch buffer permits finishing an empty stream with a zero limit.
        const chunkLength = Math.max(1, Math.min(65536, maxOutputLength - totalOutput));
        const chunk = new Int8Array(chunkLength);
        state.output = chunk;
        state.outputLength = chunkLength;
        state.outputUsed = 0;
        const status = decompress(state);
        totalOutput += state.outputUsed;
        if (totalOutput > maxOutputLength) {
            throw new BrotliDecodeError('Decompressed data exceeds maxOutputLength.', 'OUTPUT_LIMIT', inputPosition(state));
        }
        if (state.outputUsed !== 0) chunks.push(chunk.subarray(0, state.outputUsed));
        // An exact output-buffer boundary still requires a final call to validate the end.
        if (status === 1) break;
        if (status !== 2 || state.outputUsed !== chunkLength) makeError(state, -28);
    }
    const output = new Uint8Array(totalOutput);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
    }
    return output;
}
