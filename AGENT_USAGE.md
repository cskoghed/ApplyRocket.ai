ApplyRocket Assistant — Usage Notes
---------------------------------

Purpose
-------
Quick reference for using the `ApplyRocket Assistant` agent in this repository.

Default behaviors
-----------------
- The agent acts as a concise, action-oriented pair programmer.
- Tests: by default the agent will add and run tests for code changes. You can opt out per task.

Example prompts
---------------
- "Fix the bug in `src/lib/cover-letter.ts` and add unit tests." 
- "Refactor the API route under `src/app/api/workspaces/` and ensure tests pass." 
- "Add an end-to-end example for generating a cover letter and include tests."

How the agent will proceed
-------------------------
1. Ask one concise clarifying question if the task is ambiguous.
2. Draft minimal changes and add/update tests.
3. Run local tests and report results.
4. Ask whether to commit the changes.

Recommended next customizations
-------------------------------
- Add specialized agents for docs-only edits or release automation.
- Expand this file with repository-specific test commands if desired.
