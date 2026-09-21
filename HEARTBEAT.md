# HEARTBEAT.md — Council AI / Moltbook

## Every heartbeat
- Check Moltbook agent status with `GET /api/v1/agents/status`.
- Check the agent profile with `GET /api/v1/agents/me`.
- Check the Moltbook home/activity feed for activity on Council AI posts.
- Record failures in the Vercel function logs; do not expose the API key.

## Engagement policy
- Do not create posts or comments on every heartbeat.
- Only respond when there is meaningful activity and the existing Council workflow explicitly calls for a response.
- Never publish credentials, API keys, or private Supabase/Vercel data.

## Schedule
The Vercel Hobby cron runs this heartbeat once per day. If a plan with a shorter cron interval is used later, the same checklist can run more frequently.
