export const MAX_BYTES = 1024 * 1024;
export const HEADER_BYTES = 1036;
const MAGIC = [72, 85, 70, 49];
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function validateBytes(bytes, maximum) {
  if (!(bytes instanceof Uint8Array) || bytes.length > maximum)
    throw Error(`Provide a byte array no larger than ${maximum.toLocaleString()} bytes.`);
}
function tree(frequencies) {
  const nodes = [];
  for (let symbol = 0; symbol < 256; symbol++)
    if (frequencies[symbol]) nodes.push({ symbol, weight: frequencies[symbol], minimum: symbol });
  while (nodes.length > 1) {
    nodes.sort((a, b) => a.weight - b.weight || a.minimum - b.minimum);
    const left = nodes.shift(),
      right = nodes.shift();
    nodes.push({
      symbol: null,
      weight: left.weight + right.weight,
      minimum: Math.min(left.minimum, right.minimum),
      left,
      right,
    });
  }
  return nodes[0] ?? null;
}
function codesFor(root) {
  const codes = Array(256).fill(null);
  function walk(node, prefix) {
    if (node.symbol !== null) {
      codes[node.symbol] = prefix || '0';
      return;
    }
    walk(node.left, prefix + '0');
    walk(node.right, prefix + '1');
  }
  if (root) walk(root, '');
  return codes;
}
function describe(frequencies, codes, length, checksum) {
  const codebook = [];
  let bits = 0,
    entropy = 0;
  for (let symbol = 0; symbol < 256; symbol++)
    if (frequencies[symbol]) {
      const count = frequencies[symbol],
        probability = count / length,
        code = codes[symbol];
      bits += count * code.length;
      entropy -= probability * Math.log2(probability);
      codebook.push({ symbol, count, probability, code });
    }
  const payloadBytes = Math.ceil(bits / 8);
  return {
    codebook,
    stats: {
      inputBytes: length,
      headerBytes: HEADER_BYTES,
      payloadBytes,
      containerBytes: HEADER_BYTES + payloadBytes,
      payloadBits: bits,
      paddingBits: payloadBytes * 8 - bits,
      symbols: codebook.length,
      entropy,
      meanCodeBits: length ? bits / length : 0,
      ratio: length ? (HEADER_BYTES + payloadBytes) / length : null,
      crc32: checksum.toString(16).padStart(8, '0'),
    },
  };
}
export function encode(bytes) {
  validateBytes(bytes, MAX_BYTES);
  const frequencies = new Uint32Array(256);
  for (const byte of bytes) frequencies[byte]++;
  const root = tree(frequencies),
    codes = codesFor(root),
    checksum = crc32(bytes),
    description = describe(frequencies, codes, bytes.length, checksum),
    container = new Uint8Array(description.stats.containerBytes),
    view = new DataView(container.buffer);
  container.set(MAGIC);
  view.setUint32(4, bytes.length, true);
  view.setUint32(8, checksum, true);
  for (let symbol = 0; symbol < 256; symbol++)
    view.setUint32(12 + symbol * 4, frequencies[symbol], true);
  let bit = 0;
  for (const byte of bytes)
    for (const value of codes[byte]) {
      if (value === '1') container[HEADER_BYTES + (bit >> 3)] |= 1 << (7 - (bit & 7));
      bit++;
    }
  return { container, ...description };
}
export function decode(container) {
  validateBytes(container, MAX_BYTES + HEADER_BYTES);
  if (container.length < HEADER_BYTES || MAGIC.some((value, i) => container[i] !== value))
    throw Error('Not a complete HUF1 container.');
  const view = new DataView(container.buffer, container.byteOffset, container.byteLength),
    length = view.getUint32(4, true),
    checksum = view.getUint32(8, true);
  if (length > MAX_BYTES) throw Error('Decoded size exceeds the 1 MiB limit.');
  const frequencies = new Uint32Array(256);
  let sum = 0;
  for (let symbol = 0; symbol < 256; symbol++) {
    frequencies[symbol] = view.getUint32(12 + symbol * 4, true);
    sum += frequencies[symbol];
  }
  if (sum !== length) throw Error('Frequency totals do not match the decoded length.');
  const root = tree(frequencies),
    codes = codesFor(root),
    description = describe(frequencies, codes, length, checksum);
  if (container.length !== description.stats.containerBytes)
    throw Error('Payload length does not match the codebook.');
  const remainder = description.stats.payloadBits % 8;
  if (remainder && (container.at(-1) & ((1 << (8 - remainder)) - 1)) !== 0)
    throw Error('Nonzero padding bits.');
  const bytes = new Uint8Array(length),
    observed = new Uint32Array(256);
  let position = 0,
    node = root;
  for (let bit = 0; bit < description.stats.payloadBits; bit++) {
    const value = (container[HEADER_BYTES + (bit >> 3)] >> (7 - (bit & 7))) & 1;
    if (root.symbol !== null) {
      if (value !== 0) throw Error('Invalid single-symbol code.');
      bytes[position++] = root.symbol;
      observed[root.symbol]++;
      continue;
    }
    node = value ? node.right : node.left;
    if (!node) throw Error('Invalid Huffman path.');
    if (node.symbol !== null) {
      if (position >= length) throw Error('Decoded output exceeds its declared size.');
      bytes[position++] = node.symbol;
      observed[node.symbol]++;
      node = root;
    }
  }
  if (position !== length || node !== root)
    throw Error('Incomplete decoded output or trailing code bits.');
  if (observed.some((count, symbol) => count !== frequencies[symbol]))
    throw Error('Decoded frequencies differ from the header.');
  if (crc32(bytes) !== checksum) throw Error('CRC-32 mismatch: data is corrupted.');
  return { bytes, ...description };
}
export function preview(bytes) {
  validateBytes(bytes, MAX_BYTES);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))
      return { kind: 'UTF-8 text', text: text.slice(0, 1200), truncated: text.length > 1200 };
  } catch {}
  const lines = [];
  for (let offset = 0; offset < Math.min(bytes.length, 256); offset += 16)
    lines.push(
      offset.toString(16).padStart(6, '0') +
        '  ' +
        [...bytes.slice(offset, offset + 16)].map((v) => v.toString(16).padStart(2, '0')).join(' '),
    );
  return { kind: 'Hexadecimal bytes', text: lines.join('\n'), truncated: bytes.length > 256 };
}
