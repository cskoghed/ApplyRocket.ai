# ApplyRocket.AI

ApplyRocket.AI is a job-application assistant that lets users upload a CV and supporting files, describe a target role, generate a cover letter, and edit the result directly in the browser.

## Authentication

The app now requires an account to access saved workspaces and cover-letter generation.

- Users sign up with email + password.
- Passwords are stored as one-way `scrypt` hashes with per-user salts.
- Sessions are stored server-side and sent through an HTTP-only cookie.
- Existing browser-bound workspaces from the earlier cookie-based model are migrated into the user account at sign-in.

## LLM setup

Cover letter generation now calls a configured LLM provider API directly.

1. Copy `.env.example` to `.env.local`.
2. Set `LLM_PROVIDER` to one of: `openai`, `anthropic`, `gemini`.
3. Set the matching API key (and optional model override):
   - `OPENAI_API_KEY` / `OPENAI_MODEL`
   - `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`
   - `GEMINI_API_KEY` / `GEMINI_MODEL`

If the selected provider is missing credentials or returns an error, the API route responds with an explicit error so the UI can surface it.
