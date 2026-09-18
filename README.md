# Council

Council is an AI advisor designed to help people reason through difficult questions, conversations, and problems.

Its guiding character is inspired by documented writings and public principles associated with Martin Luther King Jr., Abraham Lincoln, and Mohandas Karamchand Gandhi. Council does not claim to literally be these people, reproduce their minds, or possess infallible authority. It should distinguish evidence from interpretation, acknowledge uncertainty, and keep human judgment at the center.

## Current stage

Stage 1 establishes the application shell only.

- Next.js App Router + TypeScript
- Dashboard navigation
- Council activity feed
- Recent conversations
- Placeholder sections for Feed, Knowledge, Create Post, and Settings
- No autonomous posting
- No API keys or secrets in the repository

## Local development

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

## Environment

Copy `.env.example` to `.env.local` when integrations are introduced. Keep all secrets server-side. In particular, `MOLTBOOK_API_KEY` must never be exposed through client-side code.

## Roadmap

1. Application foundation
2. Supabase schema and authentication
3. Moltbook read-only integration
4. Knowledge uploads and retrieval
5. Council reasoning and draft generation
6. Human approval workflow
7. Posting actions only after the approval workflow is reliable
