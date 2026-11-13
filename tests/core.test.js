import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, crc32, preview, HEADER_BYTES, MAX_BYTES } from '../core.js';
const utf8 = (text) => new TextEncoder().encode(text);
test('CRC-32 matches the standard check vector and empty input', () => {
  assert.equal(crc32(utf8('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});
test('empty and single-symbol inputs round trip with explicit padding', () => {
  for (const bytes of [new Uint8Array(), Uint8Array.of(65), new Uint8Array(17).fill(255)]) {
    const r = encode(bytes);
    assert.deepEqual(decode(r.container).bytes, bytes);
    assert.equal(r.container.length, HEADER_BYTES + Math.ceil(bytes.length / 8));
  }
  assert.equal(encode(Uint8Array.of(1)).stats.paddingBits, 7);
});
test('every byte value gets an eight-bit code under a uniform distribution', () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i),
    r = encode(bytes);
  assert.equal(r.stats.payloadBits, 2048);
  assert.equal(r.stats.entropy, 8);
  assert.ok(r.codebook.every((row) => row.code.length === 8));
  assert.deepEqual(decode(r.container).bytes, bytes);
});
test('seeded binary inputs round trip over varied alphabet sizes', () => {
  let seed = 817;
  const random = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let trial = 0; trial < 180; trial++) {
    const alphabet = 1 + random(256),
      bytes = Uint8Array.from({ length: random(4097) }, () => random(alphabet)),
      r = encode(bytes);
    assert.deepEqual(decode(r.container).bytes, bytes);
    assert.equal(r.stats.containerBytes, r.container.length);
  }
});
test('codes are prefix-free and their mean length respects the entropy bound', () => {
  const bytes = utf8('aaabbcdddddddddeffffgggggggggggggg'),
    r = encode(bytes);
  for (const a of r.codebook)
    for (const b of r.codebook)
      if (a.symbol !== b.symbol) assert.equal(b.code.startsWith(a.code), false);
  assert.ok(r.stats.meanCodeBits >= r.stats.entropy - 1e-12);
  assert.ok(r.stats.meanCodeBits < r.stats.entropy + 1);
});
test('independent reference decoder reads MSB-first payload bits', () => {
  const input = utf8('a compact prefix code has uneven frequencies'),
    r = encode(input),
    lookup = new Map(r.codebook.map((row) => [row.code, row.symbol])),
    output = [];
  let pending = '';
  for (let bit = 0; bit < r.stats.payloadBits; bit++) {
    pending += String((r.container[HEADER_BYTES + (bit >> 3)] >> (7 - (bit & 7))) & 1);
    if (lookup.has(pending)) {
      output.push(lookup.get(pending));
      pending = '';
    }
  }
  assert.equal(pending, '');
  assert.deepEqual(Uint8Array.from(output), input);
});
test('headers are little-endian and byte-offset views decode correctly', () => {
  const r = encode(utf8('ABC')),
    view = new DataView(r.container.buffer);
  assert.equal(view.getUint32(4, true), 3);
  assert.equal(view.getUint32(12 + 65 * 4, true), 1);
  const padded = new Uint8Array(r.container.length + 10);
  padded.set(r.container, 5);
  assert.deepEqual(decode(padded.subarray(5, -5)).bytes, utf8('ABC'));
});
test('corrupt magic, checksum, frequencies, payload, padding, and length are rejected', () => {
  const original = encode(utf8('aaabbbccdde')).container;
  for (const offset of [0, 8, 12 + 97 * 4, HEADER_BYTES]) {
    const damaged = original.slice();
    damaged[offset] ^= 1;
    assert.throws(() => decode(damaged));
  }
  assert.throws(() => decode(original.slice(0, -1)));
  assert.throws(() => decode(new Uint8Array([...original, 0])));
  const padding = encode(Uint8Array.of(65)).container;
  padding[HEADER_BYTES] |= 1;
  assert.throws(() => decode(padding));
});
test('oversized declared output is rejected before allocation', () => {
  const container = encode(new Uint8Array()).container;
  new DataView(container.buffer).setUint32(4, MAX_BYTES + 1, true);
  assert.throws(() => decode(container), /limit/);
  assert.throws(() => encode(new Uint8Array(MAX_BYTES + 1)));
  assert.throws(() => encode([1, 2, 3]));
});
test('Unicode and binary previews are distinct and bounded', () => {
  const text = 'Héllo 🌍';
  assert.equal(preview(utf8(text)).text, text);
  assert.equal(preview(Uint8Array.of(0, 255, 1)).kind, 'Hexadecimal bytes');
  assert.equal(preview(utf8('x'.repeat(1300))).truncated, true);
});
test('encoding is deterministic and never changes the source bytes', () => {
  const bytes = utf8('same frequencies, stable tree'),
    before = bytes.slice();
  assert.deepEqual(encode(bytes), encode(bytes));
  assert.deepEqual(bytes, before);
});
test('one-mebibyte limit round trips and reports actual container overhead', () => {
  const bytes = new Uint8Array(MAX_BYTES).fill(7),
    r = encode(bytes);
  assert.deepEqual(decode(r.container).bytes, bytes);
  assert.equal(r.stats.containerBytes, HEADER_BYTES + MAX_BYTES / 8);
  assert.equal(r.stats.ratio, r.container.length / bytes.length);
});
