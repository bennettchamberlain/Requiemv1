export async function* ndjsonStream<T>(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder = new TextDecoder(),
) {
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      buffer += decoder.decode(value, { stream: true });

      let lines = buffer.split('\n');

      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        try {
          yield JSON.parse(line) as T;
        } catch (err) {
          // Optionally: log or ignore
          // console.error('JSON parse error on line:', line);
        }
      }
    }
  }

  // Flush last buffer
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer) as T;
    } catch (err) {
      // console.error('JSON parse error on buffer:', buffer);
    }
  }
}
