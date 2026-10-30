/** Incremental SSE framing shared by the model transport and admin client. */
export function createSseParser(onData) {
  let buffer = '';
  let data = [];
  const line = (value) => {
    if (value === '') {
      if (data.length) onData(data.join('\n'));
      data = [];
    } else if (value.startsWith('data:')) {
      data.push(value.slice(5).replace(/^ /, ''));
    }
  };
  return {
    push(chunk) {
      buffer += chunk;
      let index;
      while ((index = buffer.search(/[\r\n]/)) >= 0) {
        // A CRLF pair can straddle transport chunks.
        if (buffer[index] === '\r' && index === buffer.length - 1) break;
        const width =
          buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
        line(buffer.slice(0, index));
        buffer = buffer.slice(index + width);
      }
      if (buffer.length + data.join('').length > 1_000_000)
        throw new Error('SSE event too large');
    },
    finish() {
      if (buffer) line(buffer.replace(/\r$/, ''));
      line('');
      buffer = '';
    },
  };
}
