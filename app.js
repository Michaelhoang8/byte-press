import { MAX_BYTES, HEADER_BYTES } from './core.js';
const $ = (id) => document.getElementById(id),
  el = (tag, text) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    return n;
  };
let sourceBytes = null,
  sourceName = 'text.txt',
  worker = null,
  result = null,
  revision = 0,
  fileRevision = 0,
  downloadName = 'text.txt.huf';
function sourceInfo() {
  const textMode = $('source-mode').value === 'text';
  $('text').hidden = !textMode;
  $('file-source').hidden = textMode;
  const length = textMode ? new TextEncoder().encode($('text').value).length : sourceBytes?.length;
  $('source-info').textContent =
    length === undefined
      ? 'Choose a binary source file.'
      : `${length.toLocaleString()} bytes / ${MAX_BYTES.toLocaleString()} byte limit${length > MAX_BYTES ? ' · source exceeds limit' : ''}`;
}
function invalidate(message = 'Source changed. Encode again to update the result.') {
  revision++;
  worker?.terminate();
  worker = null;
  result = null;
  $('output').hidden = true;
  $('cancel').disabled = true;
  $('status').textContent = message;
  sourceInfo();
}
$('text').oninput = () => {
  fileRevision++;
  invalidate();
};
$('source-mode').onchange = () => {
  fileRevision++;
  invalidate();
};
$('cancel').onclick = () => invalidate('Codec operation cancelled.');
function run(action, bytes, name) {
  fileRevision++;
  invalidate(
    action === 'encode'
      ? 'Encoding, then checking every decoded byte…'
      : 'Decoding and checking the container…',
  );
  const ticket = revision;
  $('cancel').disabled = false;
  downloadName =
    action === 'encode' ? `${name}.huf` : `decoded-${name.replace(/\.huf$/i, '') || 'data.bin'}`;
  try {
    worker = new Worker('./worker.js', { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (ticket !== revision) return;
      worker.terminate();
      worker = null;
      $('cancel').disabled = true;
      if (data.error) {
        invalidate(data.error);
        return;
      }
      result = data;
      display();
    };
    worker.onerror = (event) => invalidate(`Codec failed: ${event.message}`);
    const copy = bytes.slice();
    worker.postMessage({ action, buffer: copy.buffer }, [copy.buffer]);
  } catch (error) {
    invalidate(error.message);
  }
}
$('encode').onclick = () => {
  const textMode = $('source-mode').value === 'text',
    bytes = textMode ? new TextEncoder().encode($('text').value) : sourceBytes;
  if (!bytes) {
    $('status').textContent = 'Choose a source file first.';
    return;
  }
  if (bytes.length > MAX_BYTES) {
    invalidate('Source exceeds the 1 MiB limit.');
    return;
  }
  run('encode', bytes, textMode ? 'text.txt' : sourceName);
};
$('source-file').onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const ticket = ++fileRevision;
  invalidate('Reading source file…');
  try {
    if (file.size > MAX_BYTES) throw Error('Source exceeds the 1 MiB limit.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (ticket !== fileRevision) return;
    sourceBytes = bytes;
    sourceName = file.name;
    $('file-info').textContent = `${file.name} · ${bytes.length.toLocaleString()} bytes`;
    invalidate('File loaded. Encode when ready.');
  } catch (error) {
    if (ticket === fileRevision) $('status').textContent = error.message;
  }
};
$('decode-file').onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  const ticket = ++fileRevision;
  invalidate('Reading HUF1 container…');
  try {
    if (file.size > MAX_BYTES + HEADER_BYTES)
      throw Error('Container exceeds the supported size limit.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (ticket !== fileRevision) return;
    run('decode', bytes, file.name);
  } catch (error) {
    if (ticket === fileRevision) $('status').textContent = error.message;
  }
};
function byteName(symbol) {
  const special = { 0: 'NUL', 9: 'TAB', 10: 'LF', 13: 'CR', 32: 'SPACE' };
  return `0x${symbol.toString(16).padStart(2, '0')} · ${special[symbol] ?? (symbol >= 33 && symbol <= 126 ? String.fromCharCode(symbol) : 'byte')}`;
}
function codebook() {
  if (!result) return;
  const filter = $('filter').value.toLowerCase();
  $('codebook').replaceChildren();
  for (const entry of [...result.codebook].sort(
    (a, b) => b.count - a.count || a.symbol - b.symbol,
  )) {
    const name = byteName(entry.symbol);
    if (filter && !name.toLowerCase().includes(filter) && String(entry.symbol) !== filter) continue;
    const row = el('tr');
    for (const value of [
      name,
      entry.count.toLocaleString(),
      (entry.probability * 100).toFixed(2) + '%',
      entry.code,
      entry.code.length,
    ])
      row.append(el('td', value));
    $('codebook').append(row);
  }
  if (!$('codebook').children.length) {
    const row = el('tr'),
      cell = el('td', 'No matching bytes.');
    cell.colSpan = 5;
    row.append(cell);
    $('codebook').append(row);
  }
}
$('filter').oninput = codebook;
function display() {
  const s = result.stats;
  $('output').hidden = false;
  $('original').textContent = s.inputBytes.toLocaleString();
  $('container').textContent = s.containerBytes.toLocaleString();
  $('saving').textContent =
    s.ratio === null
      ? 'Empty source'
      : s.ratio <= 1
        ? `${((1 - s.ratio) * 100).toFixed(1)}% smaller`
        : `${((s.ratio - 1) * 100).toFixed(1)}% larger`;
  $('result-title').textContent =
    result.action === 'encode' ? '02 / Encoded & verified' : '02 / Decoded & checked';
  $('download').textContent =
    result.action === 'encode' ? 'Download .huf' : 'Download decoded bytes';
  $('breakdown').textContent =
    `${s.headerBytes.toLocaleString()} header + ${s.payloadBytes.toLocaleString()} payload bytes · ${s.paddingBits} padding bits`;
  $('entropy').textContent =
    `Entropy ${s.entropy.toFixed(3)} bits/byte · mean code ${s.meanCodeBits.toFixed(3)} bits/byte`;
  $('checksum').textContent = `CRC-32 ${s.crc32} · ${s.symbols} distinct bytes`;
  $('preview-label').textContent =
    `${result.preview.kind}${result.preview.truncated ? ' · preview truncated; download contains all bytes' : ''}`;
  $('preview').textContent = result.preview.text || '(empty source)';
  $('status').textContent =
    result.action === 'encode'
      ? `Encoded and decoded back to identical bytes · ${result.milliseconds.toFixed(2)} ms.`
      : `Decoded successfully; length, frequencies, padding, and CRC-32 verified · ${result.milliseconds.toFixed(2)} ms.`;
  codebook();
}
function download(bytes, name, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type })),
    a = el('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$('download').onclick = () => {
  if (result) download(result.action === 'encode' ? result.container : result.bytes, downloadName);
};
$('report').onclick = () => {
  if (result)
    download(
      JSON.stringify(
        {
          action: result.action,
          stats: result.stats,
          codebook: result.codebook,
          milliseconds: result.milliseconds,
        },
        null,
        2,
      ),
      'byte-press-analysis.json',
      'application/json',
    );
};
function sample() {
  fileRevision++;
  if ($('example').value === 'uniform') {
    sourceBytes = Uint8Array.from({ length: 4096 }, (_, i) => i % 256);
    sourceName = 'uniform-bytes.bin';
    $('source-mode').value = 'file';
    $('file-info').textContent = 'uniform-bytes.bin · 4,096 synthetic bytes';
  } else {
    $('source-mode').value = 'text';
    $('text').value =
      'A smaller alphabet needs fewer bits. Frequent bytes get shorter codes. A lossless file must decode to exactly the same bytes.\n'.repeat(
        100,
      );
  }
  invalidate();
  $('encode').click();
}
$('example').onchange = sample;
sample();
