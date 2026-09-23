import { describe, expect, it } from "vitest";
import {
  appendChatMessage,
  chatBranchMap,
  chatPath,
  deepestDescendant,
  deleteChatMessage,
  editChatMessage,
  findChatMessage,
  normalizeChatTree,
  switchChatBranch,
  trimChatTree,
  type ChatBranchTree
} from "./chat-branches";
import { MAX_STORED_CHAT_MESSAGES } from "./chat-messages";
import type { CoverLetterChatMessage } from "./types";

function message(id: string, role: CoverLetterChatMessage["role"], parentId: string | null, createdAt = "2026-01-01T00:00:00.000Z"): CoverLetterChatMessage {
  return { id, role, content: `content of ${id}`, createdAt, parentId };
}

/**
 * A small branched transcript:
 *
 *   a (user) ─ b (assistant) ─ c (user) ─ d (assistant) ─ e (user)
 *                              └ c2 (user) ─ d2 (assistant)
 */
function branchedTree(): ChatBranchTree {
  return normalizeChatTree([
    message("a", "user", null, "2026-01-01T00:00:00.000Z"),
    message("b", "assistant", "a", "2026-01-01T00:00:01.000Z"),
    message("c", "user", "b", "2026-01-01T00:00:02.000Z"),
    message("d", "assistant", "c", "2026-01-01T00:00:03.000Z"),
    message("e", "user", "d", "2026-01-01T00:00:04.000Z"),
    message("c2", "user", "b", "2026-01-01T00:00:05.000Z"),
    message("d2", "assistant", "c2", "2026-01-01T00:00:06.000Z")
  ], "e");
}

describe("chat tree normalization", () => {
  it("chains a transcript that predates branches", () => {
    const legacy = [
      { id: "one", role: "user" as const, content: "hi", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "two", role: "assistant" as const, content: "hello", createdAt: "2026-01-01T00:00:01.000Z" }
    ] as CoverLetterChatMessage[];

    const tree = normalizeChatTree(legacy);

    expect(tree.messages.map((entry) => entry.parentId)).toEqual([null, "one"]);
    expect(tree.activeLeafId).toBe("two");
  });

  it("keeps an explicit root separate from the message before it", () => {
    const tree = normalizeChatTree([message("a", "user", null), message("b", "user", null)]);

    expect(tree.messages[1]?.parentId).toBeNull();
  });

  it("cuts self-referencing and circular parents", () => {
    const tree = normalizeChatTree([
      { ...message("a", "user", "b"), parentId: "b" },
      { ...message("b", "user", "a"), parentId: "a" }
    ]);

    // One link in the loop is dropped so walking up from any message terminates.
    expect(tree.messages.map((entry) => entry.parentId)).toEqual([null, "a"]);
  });

  it("drops duplicate ids and always lands on a real active leaf", () => {
    expect(normalizeChatTree([message("a", "user", null), message("a", "user", null)]).messages).toHaveLength(1);
    expect(normalizeChatTree([message("a", "user", null)], "missing").activeLeafId).toBe("a");
    expect(normalizeChatTree([], "missing").activeLeafId).toBeNull();
  });
});

describe("chat branches", () => {
  it("walks the active branch oldest first", () => {
    const tree = branchedTree();

    expect(chatPath(tree).map((entry) => entry.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(chatPath(switchChatBranch(tree, "c2")).map((entry) => entry.id)).toEqual(["a", "b", "c2", "d2"]);
  });

  it("stops walking when an ancestor is missing", () => {
    const tree: ChatBranchTree = { messages: [message("orphan", "user", "gone")], activeLeafId: "orphan" };

    expect(chatPath(tree).map((entry) => entry.id)).toEqual(["orphan"]);
  });

  it("reports branch position for messages with siblings", () => {
    const map = chatBranchMap(branchedTree().messages);

    expect(map.c).toEqual({ index: 1, total: 2, ids: ["c", "c2"] });
    expect(map.c2).toEqual({ index: 2, total: 2, ids: ["c", "c2"] });
    expect(map.a).toBeUndefined();
    expect(map.b).toBeUndefined();
  });

  it("ignores dangling parents that only came from trimming", () => {
    const map = chatBranchMap([message("a", "user", null), message("b", "user", "trimmed-away")]);

    expect(map).toEqual({});
  });

  it("treats the messages that start the conversation as siblings", () => {
    const map = chatBranchMap([message("a", "user", null), message("a-edit", "user", null)]);

    expect(map.a).toEqual({ index: 1, total: 2, ids: ["a", "a-edit"] });
    expect(map["a-edit"]).toEqual({ index: 2, total: 2, ids: ["a", "a-edit"] });
  });

  it("descends through the newest child of a branch", () => {
    const messages = branchedTree().messages;

    expect(deepestDescendant(messages, "c2")).toBe("d2");
    expect(deepestDescendant(messages, "e")).toBe("e");
  });

  it("appends a turn under the active leaf and follows it", () => {
    const tree = appendChatMessage(branchedTree(), message("f", "assistant", "e", "2026-01-01T00:00:07.000Z"));

    expect(tree.activeLeafId).toBe("f");
    expect(findChatMessage(tree.messages, "f")?.parentId).toBe("e");
  });
});

describe("editing a message into a branch", () => {
  it("keeps the original turn and switches to the edited version", () => {
    const before = branchedTree();
    const { tree, message: edited } = editChatMessage(before, "c", {
      id: "c-edit",
      content: "change the goodbye instead",
      createdAt: "2026-01-01T00:00:08.000Z"
    });

    expect(edited?.parentId).toBe("b");
    expect(edited?.content).toBe("change the goodbye instead");
    expect(tree.activeLeafId).toBe("c-edit");
    // The old wording and the answer it produced are still there.
    expect(findChatMessage(tree.messages, "c")?.content).toBe("content of c");
    expect(findChatMessage(tree.messages, "d")?.parentId).toBe("c");
    expect(chatBranchMap(tree.messages).c).toEqual({ index: 1, total: 3, ids: ["c", "c2", "c-edit"] });
  });

  it("carries the captured highlight onto the edited version", () => {
    const tree = normalizeChatTree([
      { ...message("a", "user", null), selection: "I am excited to apply." },
      message("b", "assistant", "a")
    ]);

    const { message: edited } = editChatMessage(tree, "a", { id: "a-edit", content: "tighter", createdAt: "2026-01-01T00:00:09.000Z" });

    expect(edited?.selection).toBe("I am excited to apply.");
  });

  it("does nothing for an unknown message", () => {
    const before = branchedTree();
    const { tree, message: edited } = editChatMessage(before, "nope", { id: "x", content: "y", createdAt: "2026-01-01T00:00:00.000Z" });

    expect(edited).toBeNull();
    expect(tree).toBe(before);
  });
});

describe("deleting a message", () => {
  it("removes the turn and everything after it, and reports the letter from before it", () => {
    const tree = normalizeChatTree([
      { ...message("u1", "user", null, "2026-01-01T00:00:00.000Z"), letter: "<p>original</p>" },
      { ...message("a1", "assistant", "u1", "2026-01-01T00:00:01.000Z"), letter: "<p>original plus opening</p>" },
      { ...message("u2", "user", "a1", "2026-01-01T00:00:02.000Z"), letter: "<p>original plus opening</p>" },
      { ...message("a2", "assistant", "u2", "2026-01-01T00:00:03.000Z"), letter: "<p>original plus opening and closing</p>" }
    ], "a2");

    const { tree: after, letter } = deleteChatMessage(tree, "u2");

    expect(after.messages.map((entry) => entry.id)).toEqual(["u1", "a1"]);
    expect(after.activeLeafId).toBe("a1");
    expect(letter).toBe("<p>original plus opening</p>");
  });

  it("undoes the change of a deleted answer", () => {
    const tree = normalizeChatTree([
      { ...message("u1", "user", null, "2026-01-01T00:00:00.000Z"), letter: "<p>original</p>" },
      { ...message("a1", "assistant", "u1", "2026-01-01T00:00:01.000Z"), letter: "<p>warmer opening</p>" }
    ], "a1");

    const { tree: after, letter } = deleteChatMessage(tree, "a1");

    expect(after.messages.map((entry) => entry.id)).toEqual(["u1"]);
    expect(after.activeLeafId).toBe("u1");
    expect(letter).toBe("<p>original</p>");
  });

  it("keeps the other branches of the deleted message", () => {
    const tree = normalizeChatTree([
      { ...message("u1", "user", null, "2026-01-01T00:00:00.000Z"), letter: "<p>original</p>" },
      { ...message("u2", "user", "u1", "2026-01-01T00:00:01.000Z"), letter: "<p>original</p>" },
      { ...message("u2-other", "user", "u1", "2026-01-01T00:00:02.000Z"), letter: "<p>original</p>" },
      { ...message("a2", "assistant", "u2", "2026-01-01T00:00:03.000Z"), letter: "<p>changed</p>" }
    ], "a2");

    const { tree: after } = deleteChatMessage(tree, "u2");

    expect(after.messages.map((entry) => entry.id)).toEqual(["u1", "u2-other"]);
    expect(after.activeLeafId).toBe("u2-other");
  });

  it("lands on the remaining conversation when the only branch is deleted", () => {
    const tree = normalizeChatTree([
      { ...message("u1", "user", null, "2026-01-01T00:00:00.000Z"), letter: "<p>original</p>" }
    ], "u1");

    const { tree: after, letter } = deleteChatMessage(tree, "u1");

    expect(after.messages).toEqual([]);
    expect(after.activeLeafId).toBeNull();
    expect(letter).toBe("<p>original</p>");
  });

  it("does nothing for an unknown message", () => {
    const tree = branchedTree();

    expect(deleteChatMessage(tree, "nope")).toEqual({ tree, letter: null });
  });
});

describe("a branching conversation", () => {
  /** Same sequence the workspace performs: two turns, then the second one reworked into a branch. */
  it("keeps every branch's letter and switches back to it", () => {
    let tree = normalizeChatTree([]);

    tree = appendChatMessage(tree, { ...message("u1", "user", null, "2026-01-01T00:00:00.000Z"), letter: "<p>Dear team,</p>" });
    tree = appendChatMessage(tree, {
      ...message("a1", "assistant", "u1", "2026-01-01T00:00:01.000Z"),
      letter: "<p>Dear team, I am glad to apply.</p>"
    });
    tree = appendChatMessage(tree, {
      ...message("u2", "user", "a1", "2026-01-01T00:00:02.000Z"),
      letter: "<p>Dear team, I am glad to apply.</p>"
    });
    tree = appendChatMessage(tree, {
      ...message("a2", "assistant", "u2", "2026-01-01T00:00:03.000Z"),
      letter: "<p>Dear team, I am glad to apply. Sincerely, Sam.</p>"
    });

    const { tree: branched, message: edited } = editChatMessage(tree, "u2", {
      id: "u2-branch",
      content: "change the goodbye for this role",
      createdAt: "2026-01-01T00:00:04.000Z"
    });
    const active = appendChatMessage(branched, {
      ...message("a2-branch", "assistant", "u2-branch", "2026-01-01T00:00:05.000Z"),
      letter: "<p>Dear team, I am glad to apply. Warm regards, Sam.</p>"
    });

    // The reworked turn re-runs against the letter as it stood before the original instruction.
    expect(edited?.letter).toBe("<p>Dear team, I am glad to apply.</p>");
    expect(chatPath(active).map((entry) => entry.id)).toEqual(["u1", "a1", "u2-branch", "a2-branch"]);
    expect(findChatMessage(active.messages, active.activeLeafId)?.letter).toBe("<p>Dear team, I am glad to apply. Warm regards, Sam.</p>");

    // Switching back shows the earlier wording together with the letter that turn produced.
    const restored = switchChatBranch(active, "u2");

    expect(chatPath(restored).map((entry) => entry.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect(findChatMessage(restored.messages, restored.activeLeafId)?.letter).toBe("<p>Dear team, I am glad to apply. Sincerely, Sam.</p>");
    expect(chatBranchMap(restored.messages).u2).toEqual({ index: 1, total: 2, ids: ["u2", "u2-branch"] });
  });
});

describe("chat tree trimming", () => {
  it("keeps the newest turns and rewrites the active branch when its leaf goes", () => {
    const tree = normalizeChatTree(
      Array.from({ length: MAX_STORED_CHAT_MESSAGES + 5 }, (_, index) =>
        message(`m-${index}`, index % 2 === 0 ? "user" : "assistant", index === 0 ? null : `m-${index - 1}`, `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`)
      )
    );

    const trimmed = trimChatTree({ ...tree, activeLeafId: "m-0" });

    expect(trimmed.messages).toHaveLength(MAX_STORED_CHAT_MESSAGES);
    expect(trimmed.messages[0]?.id).toBe("m-5");
    expect(trimmed.activeLeafId).toBe(`m-${MAX_STORED_CHAT_MESSAGES + 4}`);
  });

  it("keeps sibling groups together so branches survive a trim", () => {
    const tree = normalizeChatTree([
      message("a", "user", null, "2026-01-01T00:00:00.000Z"),
      message("b", "assistant", "a", "2026-01-01T00:00:01.000Z"),
      message("b2", "assistant", "a", "2026-01-01T00:00:02.000Z")
    ], "b2");

    const trimmed = trimChatTree(tree, 2);

    expect(trimmed.messages.map((entry) => entry.id)).toEqual(["b", "b2"]);
    expect(chatBranchMap(trimmed.messages).b).toEqual({ index: 1, total: 2, ids: ["b", "b2"] });
    expect(trimmed.activeLeafId).toBe("b2");
  });

  it("returns an empty tree for an empty transcript", () => {
    expect(trimChatTree({ messages: [], activeLeafId: null })).toEqual({ messages: [], activeLeafId: null });
  });
});
