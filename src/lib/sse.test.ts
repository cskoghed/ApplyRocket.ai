import { describe, expect, it } from "vitest";
import { consumeSseStream, formatSseEvent, parseSseData, readSseEvents, SseFrameParser } from "./sse";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }

      controller.enqueue(encoder.encode(chunks[index]!));
      index += 1;
    }
  });
}

describe("sse frame parser", () => {
  it("parses complete frames with an event name", () => {
    const parser = new SseFrameParser();
    const events = parser.push("event: delta\ndata: {\"text\":\"Hi\"}\n\n");

    expect(events).toEqual([{ event: "delta", data: '{"text":"Hi"}' }]);
  });

  it("buffers frames split across chunks", () => {
    const parser = new SseFrameParser();

    expect(parser.push("event: del")).toEqual([]);
    expect(parser.push('ta\ndata: {"text":"Hel')).toEqual([]);
    expect(parser.push('lo"}\n\nevent: done\ndata: {}\n\n')).toEqual([
      { event: "delta", data: '{"text":"Hello"}' },
      { event: "done", data: "{}" }
    ]);
  });

  it("defaults the event name and joins multiple data lines", () => {
    const parser = new SseFrameParser();
    const events = parser.push("data: first\ndata: second\n\n");

    expect(events).toEqual([{ event: "message", data: "first\nsecond" }]);
  });

  it("ignores comment-only frames and flushes a trailing frame", () => {
    const parser = new SseFrameParser();

    expect(parser.push(": ping\n\n")).toEqual([]);
    expect(parser.push('event: done\ndata: {"ok":true}')).toEqual([]);
    expect(parser.flush()).toEqual([{ event: "done", data: '{"ok":true}' }]);
    expect(parser.flush()).toEqual([]);
  });

  it("round-trips the server-side frame format", () => {
    const parser = new SseFrameParser();
    const frame = formatSseEvent("revision", { scope: "selection", text: "Hello" });

    expect(frame.startsWith("event: revision\ndata: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(parser.push(frame)).toEqual([{ event: "revision", data: '{"scope":"selection","text":"Hello"}' }]);
  });
});

describe("sse stream helpers", () => {
  it("reads events out of a streamed body", async () => {
    const body = streamFromChunks(['event: a\ndata: {"n":1', '}\n\nevent: b\ndata: {"n":2}\n\n']);
    const events = [];

    for await (const event of readSseEvents(body)) {
      events.push(event);
    }

    expect(events).toEqual([
      { event: "a", data: '{"n":1}' },
      { event: "b", data: '{"n":2}' }
    ]);
  });

  it("consumes a response and reports closure", async () => {
    const body = streamFromChunks(['event: delta\ndata: {"text":"Hey"}\n\n']);
    const response = new Response(body);
    const events: string[] = [];
    let closed = false;

    await consumeSseStream(
      response,
      (event) => events.push(event.event),
      () => {
        closed = true;
      }
    );

    expect(events).toEqual(["delta"]);
    expect(closed).toBe(true);
  });

  it("throws when the response has no body", async () => {
    await expect(consumeSseStream(new Response(null), () => {})).rejects.toThrow("empty stream");
  });
});

describe("parseSseData", () => {
  it("parses json payloads and tolerates invalid ones", () => {
    expect(parseSseData<{ text: string }>('{"text":"hi"}')).toEqual({ text: "hi" });
    expect(parseSseData("not json")).toBeNull();
  });
});
