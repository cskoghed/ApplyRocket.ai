# ApplyRocket.AI

ApplyRocket.AI is a job-application assistant that lets users upload a CV and supporting files, describe a target role, generate a cover letter, and edit the result directly in the browser.

## Current state

This repository now contains the initial Next.js + TypeScript scaffold, the first workspace UI, and a cover-letter generation route with a deterministic fallback if OpenAI is not configured yet.

## Next steps

1. Install dependencies.
2. Wire document parsing and richer upload validation.
3. Replace the fallback generation path with a fully configured OpenAI workflow.
4. Add persistence for drafts and uploads.
