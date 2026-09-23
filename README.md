# ApplyRocket.AI

ApplyRocket.AI is a job-application assistant that lets users upload a CV and supporting files, describe a target role, generate a cover letter, and edit the result directly in the browser.

## Authentication

The app now requires an account to access saved applications, your document library, and cover-letter generation.

- Users sign up with email + password.
- Passwords are stored as one-way `scrypt` hashes with per-user salts.
- Sessions are stored server-side and sent through an HTTP-only cookie.
- Existing browser-bound applications from the earlier cookie-based model are migrated into the user account at sign-in.

## Documents

Uploaded CVs and supporting files are extracted client-side, then saved to a document library bound to your account. Each document gets its own id, so the same document can be attached to multiple applications by selecting it in the UI. Deleting a document removes it from the library entirely; unattaching it from an application only removes the association.

## Database

Auth, sessions, documents, and applications now use a SQLite database instead of JSON files.

- By default the app stores data in `data/applyrocket.db`.
- Override the path with `DATABASE_PATH` in `.env.local` if needed.
- On first startup, existing JSON records from `data/auth` and `data/workspaces` are migrated into SQLite automatically (including turning each application's inline documents into library entries).

## LLM setup

Cover letter generation now calls a configured LLM provider API directly.

1. Copy `.env.example` to `.env.local`.
2. Set `LLM_PROVIDER` to one of: `openai`, `anthropic`, `gemini`.
3. Set the matching API key (and optional model override):
   - `OPENAI_API_KEY` / `OPENAI_MODEL`
   - `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`
   - `GEMINI_API_KEY` / `GEMINI_MODEL`

If the selected provider is missing credentials or returns an error, the API route responds with an explicit error so the UI can surface it.

## Cover letter chat

The draft editor has a chat panel for iterating on a generated cover letter.

- Type an instruction such as "make the closing more confident" and press Enter.
- Select text in the editor first to scope the change to that passage only. The panel shows the captured highlight, and the AI is instructed that no other sentence of the letter may change. With no highlight, the model names the exact text it is replacing in a `<find>` block, and the server splices the change into the letter so the rest of the draft is untouched. A revision that would not change anything is dropped, and an answer too short to be the whole letter without an anchor is refused rather than applied over the draft.
- **The pen** on one of your own messages reworks it into a new branch of the conversation: the edited instruction is re-run against the letter as it stood before the original message, while the previous wording and its answer stay reachable through the `n/m` branch switcher. Switching branches restores the letter that belongs to that branch. Each turn stores its letter snapshot, and the conversation structure lives alongside the transcript in `chat_json`.
- **The trash** removes a message together with everything that came after it on that branch and moves the letter back to how it was before that turn, so deleting an instruction undoes the change it asked for. The other branches at that point are untouched.
- While a passage is highlighted, the editor keeps showing it highlighted even after focus moves to the chat box (CSS Custom Highlight API, so the letter's markup and the caret are never touched). The highlight never doubles up with the browser's own selection, and after the AI rewrites a highlighted passage the rewritten text takes over the highlight, so the next instruction is scoped to the new wording. The captured passage is read out of the editor's own text, so highlights that span a paragraph break behave like any other.
- Replies stream token by token from `POST /api/cover-letter-chat` as Server-Sent Events (`delta`, `revision`, `done`, `error`), so the assistant text appears as it is written.
- Applied changes can be reverted with **Undo change**, and the transcript is saved with the application in the `chat_json` column of the `applications` table (existing databases are upgraded in place; transcripts saved before branching are chained into a tree when they are read).
- The chat reuses `LLM_PROVIDER` and the provider keys above; OpenAI, Anthropic, and Gemini all stream through the same route.
