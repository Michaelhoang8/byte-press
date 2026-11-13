import { encode, decode, preview } from './core.js';
self.onmessage = ({ data }) => {
  try {
    const input = new Uint8Array(data.buffer),
      started = performance.now();
    if (data.action === 'encode') {
      const result = encode(input),
        roundtrip = decode(result.container);
      if (
        roundtrip.bytes.length !== input.length ||
        roundtrip.bytes.some((value, i) => value !== input[i])
      )
        throw Error('Round-trip verification failed.');
      self.postMessage(
        {
          action: 'encode',
          ...result,
          preview: preview(input),
          milliseconds: performance.now() - started,
        },
        [result.container.buffer],
      );
    } else if (data.action === 'decode') {
      const result = decode(input);
      self.postMessage(
        {
          action: 'decode',
          ...result,
          preview: preview(result.bytes),
          milliseconds: performance.now() - started,
        },
        [result.bytes.buffer],
      );
    } else throw Error('Unknown codec action.');
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
