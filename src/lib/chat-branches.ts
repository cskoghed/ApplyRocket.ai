import { MAX_STORED_CHAT_MESSAGES } from "./chat-messages";
import type { CoverLetterChatMessage } from "./types";

/**
 * The chat transcript is a tree: every turn points at the turn it follows through `parentId`, and
 * messages that share a parent are the branches of that point in the conversation. Editing a message
 * adds a sibling instead of overwriting it, so the previous wording and its answer stay reachable.
 *
 * These helpers are pure so the workspace only has to hold the tree and the branch it is showing.
 */

export type ChatBranchTree = {
  messages: CoverLetterChatMessage[];
  /** The last message of the branch currently on screen. */
  activeLeafId: string | null;
};

export type ChatBranchInfo = {
  /** 1-based position of this message among its siblings. */
  index: number;
  total: number;
  /** Sibling ids in creation order, so the UI can step to the previous or next branch. */
  ids: string[];
};

export function findChatMessage(messages: CoverLetterChatMessage[], id: string | null): CoverLetterChatMessage | null {
  if (!id) {
    return null;
  }

  return messages.find((message) => message.id === id) ?? null;
}

/**
 * Heals whatever came out of storage: legacy flat transcripts are chained in array order, duplicated
 * ids are dropped, and self-referencing or circular parents are cut. Dangling parents are kept, since
 * a trimmed ancestor must not merge unrelated branches together.
 */
export function normalizeChatTree(
  messages: CoverLetterChatMessage[] | undefined,
  activeLeafId?: string | null
): ChatBranchTree {
  const ordered: CoverLetterChatMessage[] = [];
  const byId = new Map<string, CoverLetterChatMessage>();

  for (const message of messages ?? []) {
    if (!message || typeof message.id !== "string" || byId.has(message.id)) {
      continue;
    }

    const stored = (message as { parentId?: unknown }).parentId;
    const parentId =
      typeof stored === "string" ? stored : stored === undefined ? ordered[ordered.length - 1]?.id ?? null : null;
    const normalized: CoverLetterChatMessage = { ...message, parentId: parentId === message.id ? null : parentId };

    ordered.push(normalized);
    byId.set(normalized.id, normalized);
  }

  for (const message of ordered) {
    const seen = new Set([message.id]);
    let cursor = message.parentId;

    while (cursor) {
      if (seen.has(cursor)) {
        message.parentId = null;
        break;
      }

      seen.add(cursor);
      cursor = findChatMessage(ordered, cursor)?.parentId ?? null;
    }
  }

  const fallbackLeaf = ordered.length ? ordered[ordered.length - 1]!.id : null;
  const activeLeaf = activeLeafId && byId.has(activeLeafId) ? activeLeafId : fallbackLeaf;

  return { messages: ordered, activeLeafId: activeLeaf };
}

/** The messages leading to the active branch, oldest first. */
export function chatPath(tree: ChatBranchTree): CoverLetterChatMessage[] {
  const path: CoverLetterChatMessage[] = [];
  const seen = new Set<string>();
  let cursor = tree.activeLeafId;

  while (cursor) {
    const message = findChatMessage(tree.messages, cursor);
    if (!message || seen.has(message.id)) {
      break;
    }

    seen.add(message.id);
    path.push(message);
    cursor = message.parentId;
  }

  return path.reverse();
}

/** Branch metadata for every message that has siblings; other messages are absent from the map. */
export function chatBranchMap(messages: CoverLetterChatMessage[]): Record<string, ChatBranchInfo> {
  const groups = new Map<string, CoverLetterChatMessage[]>();

  for (const message of messages) {
    // Messages that start the conversation are siblings of each other, so they group under one key.
    const key = message.parentId ?? "";
    const siblings = groups.get(key) ?? [];
    siblings.push(message);
    groups.set(key, siblings);
  }

  const map: Record<string, ChatBranchInfo> = {};

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const ids = group.map((message) => message.id);
    group.forEach((message, index) => {
      map[message.id] = { index: index + 1, total: group.length, ids };
    });
  }

  return map;
}

/** Follows the newest child down the tree, which is where a branch is left when it is left alone. */
export function deepestDescendant(messages: CoverLetterChatMessage[], id: string): string {
  let cursor = id;
  const seen = new Set([id]);

  for (;;) {
    const children = messages.filter((message) => message.parentId === cursor);
    const newest = children[children.length - 1];
    if (!newest || seen.has(newest.id)) {
      return cursor;
    }

    seen.add(newest.id);
    cursor = newest.id;
  }
}

export function appendChatMessage(tree: ChatBranchTree, message: CoverLetterChatMessage): ChatBranchTree {
  return trimChatTree({ messages: [...tree.messages, message], activeLeafId: message.id });
}

export type ChatMessageEdit = {
  id: string;
  content: string;
  createdAt: string;
  /** Letter snapshot to record for the new branch; defaults to the one the original message has. */
  letter?: string;
};

/**
 * Adds an edited version of a message as its own branch, keeping the message it was forked from
 * (including that branch's later turns) available through the branch switcher.
 */
export function editChatMessage(
  tree: ChatBranchTree,
  id: string,
  edit: ChatMessageEdit
): { tree: ChatBranchTree; message: CoverLetterChatMessage | null } {
  const original = findChatMessage(tree.messages, id);
  if (!original) {
    return { tree, message: null };
  }

  const edited: CoverLetterChatMessage = {
    ...original,
    id: edit.id,
    content: edit.content,
    createdAt: edit.createdAt,
    letter: edit.letter ?? original.letter
  };

  return {
    tree: trimChatTree({ messages: [...tree.messages, edited], activeLeafId: edited.id }),
    message: edited
  };
}

/** Shows the branch that leads through `id`, ending wherever that branch was left. */
export function switchChatBranch(tree: ChatBranchTree, id: string): ChatBranchTree {
  if (!findChatMessage(tree.messages, id)) {
    return tree;
  }

  return { messages: tree.messages, activeLeafId: deepestDescendant(tree.messages, id) };
}

/**
 * The letter as it stood before this turn ran: a user turn stores that state itself, and an assistant
 * turn takes it from the instruction it answered.
 */
export function letterBeforeTurn(message: CoverLetterChatMessage, messages: CoverLetterChatMessage[]): string | null {
  if (message.role === "user") {
    return message.letter ?? null;
  }

  return findChatMessage(messages, message.parentId)?.letter ?? message.letter ?? null;
}

/** The message and everything that was built on top of it. */
function collectTurnSubtree(messages: CoverLetterChatMessage[], id: string): Set<string> {
  const removed = new Set<string>();
  const queue = [id];

  while (queue.length) {
    const current = queue.shift()!;
    if (removed.has(current)) {
      continue;
    }

    removed.add(current);
    for (const message of messages) {
      if (message.parentId === current) {
        queue.push(message.id);
      }
    }
  }

  return removed;
}

/** The newest message nothing points at, used when a deletion empties a whole branch. */
function newestTrailingMessage(messages: CoverLetterChatMessage[]): CoverLetterChatMessage | null {
  const roots = messages.filter((message) => !findChatMessage(messages, message.parentId));
  return roots[roots.length - 1] ?? null;
}

/**
 * Removes a turn together with everything that came after it on that branch, and reports the letter
 * state to restore so the draft goes back to how it was before that turn.
 */
export function deleteChatMessage(tree: ChatBranchTree, id: string): { tree: ChatBranchTree; letter: string | null } {
  const target = findChatMessage(tree.messages, id);
  if (!target) {
    return { tree, letter: null };
  }

  const removed = collectTurnSubtree(tree.messages, id);
  const messages = tree.messages.filter((message) => !removed.has(message.id));
  const parent = findChatMessage(messages, target.parentId);
  const leaf = parent ?? newestTrailingMessage(messages);

  return {
    tree: { messages, activeLeafId: leaf ? deepestDescendant(messages, leaf.id) : null },
    letter: letterBeforeTurn(target, tree.messages)
  };
}

/**
 * Keeps the newest turns. A kept message whose parent fell outside the window keeps pointing at it, so
 * sibling groups stay intact and the active branch is rewritten only when its own leaf was dropped.
 */
export function trimChatTree(tree: ChatBranchTree, limit = MAX_STORED_CHAT_MESSAGES): ChatBranchTree {
  const normalized = normalizeChatTree(tree.messages, tree.activeLeafId);
  if (normalized.messages.length <= limit) {
    return normalized;
  }

  const keepIds = new Set(
    normalized.messages
      .map((message, index) => ({ message, index }))
      .sort((a, b) => {
        if (a.message.createdAt === b.message.createdAt) {
          return a.index - b.index;
        }

        return a.message.createdAt < b.message.createdAt ? -1 : 1;
      })
      .slice(-limit)
      .map((entry) => entry.message.id)
  );

  const messages = normalized.messages.filter((message) => keepIds.has(message.id));
  const activeLeafId =
    normalized.activeLeafId && keepIds.has(normalized.activeLeafId)
      ? normalized.activeLeafId
      : messages[messages.length - 1]?.id ?? null;

  return { messages, activeLeafId };
}
