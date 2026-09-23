/**
 * Minimal Server-Sent Events helpers shared by the cover-letter chat route and its client.
 *
 * The parser assumes one `data:` line per event, which is what the OpenAI, Anthropic, and
 * Gemini streaming endpoints all emit. Multi-line `data:` fields are joined with newlines
 * anyway so nothing is lost if a provider ever sends them.
 */

export type SseEvent = {
  event: string;
  data: string;
};

const DEFAULT_EVENT_NAME = "message";

function parseBlock(block: string): SseEvent | null {
  if (!block.trim()) {
    return null;
  }

  let event = DEFAULT_EVENT_NAME;
  const dataLines: string[] = [];

  for (const rawLine of block.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (!line || line.startsWith(":")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") {
      event = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  if (!dataLines.length) {
    return null;
  }

  return { event, data: dataLines.join("\n") };
}

export class SseFrameParser {
  private carry = "";

  push(chunk: string): SseEvent[] {
    this.carry += chunk;
    const events: SseEvent[] = [];
    let boundary = this.carry.indexOf("\n\n");

    while (boundary !== -1) {
      const block = this.carry.slice(0, boundary);
      this.carry = this.carry.slice(boundary + 2);

      const event = parseBlock(block);
      if (event) {
        events.push(event);
      }

      boundary = this.carry.indexOf("\n\n");
    }

    return events;
  }

  flush(): SseEvent[] {
    const event = parseBlock(this.carry);
    this.carry = "";
    return event ? [event] : [];
  }
}

export function formatSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseFrameParser();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        yield event;
      }
    }

    for (const event of parser.push(decoder.decode())) {
      yield event;
    }

    for (const event of parser.flush()) {
      yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function consumeSseStream(
  response: Response,
  onEvent: (event: SseEvent) => void,
  onClose?: () => void
): Promise<void> {
  if (!response.body) {
    throw new Error("The server returned an empty stream.");
  }

  for await (const event of readSseEvents(response.body)) {
    onEvent(event);
  }

  onClose?.();
}

export function parseSseData<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}
