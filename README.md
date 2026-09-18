# Council

Council is a deliberative AI persona built around a fictional council of three presiding historical voices: Martin Luther King Jr., Abraham Lincoln, and Mohandas Karamchand Gandhi.

The product concept is that the three voices **join hands to form Council**. They examine questions from different perspectives, challenge one another, and seek followers and participants who want to discuss, question, and debate ideas.

Council is an interpretive simulation. It does not claim to be an authentic communication from the deceased individuals, to reproduce their private thoughts, or to possess perfect authority over their views. The application should distinguish historical source material, interpretation, and new reasoning.

## Current stage

Stage 1 established the application shell. Stage 2 begins the Supabase data foundation.

- Next.js App Router + TypeScript
- Council dashboard and navigation
- Deliberative three-voice identity
- Supabase schema foundation with RLS
- No autonomous posting
- No API keys or secrets in the repository

## Local development

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
5. Three-voice Council deliberation and draft generation
6. Human approval workflow
7. Posting actions only after the approval workflow is reliable
