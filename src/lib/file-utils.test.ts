import { afterEach, describe, expect, it } from "vitest";
import { createSecureDocumentId } from "./file-utils";

const originalCrypto = globalThis.crypto;

describe("file utils", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "crypto", {
      value: originalCrypto,
      configurable: true
    });
  });

  it("creates UUIDs with the native randomUUID API when available", () => {
    const id = createSecureDocumentId();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("falls back to getRandomValues when randomUUID is unavailable", () => {
    Object.defineProperty(globalThis, "crypto", {
      value: {
        getRandomValues(target: Uint8Array) {
          for (let index = 0; index < target.length; index += 1) {
            target[index] = index;
          }

          return target;
        }
      },
      configurable: true
    });

    expect(createSecureDocumentId()).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
  });
});
