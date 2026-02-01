# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Deep Research Agent - A Cloudflare Worker that provides an AI-powered research API using OpenAI's Responses API with web search capabilities. It performs multi-round web searches, extracts facts, synthesizes answers with citations, and validates claims.

## Commands

```bash
# Development
npm run dev          # Start local dev server (wrangler dev)
npm run deploy       # Deploy to Cloudflare Workers

# Secrets
wrangler secret put OPENAI_API_KEY   # Set OpenAI API key
```

## Architecture

### API Endpoints (src/worker.js)
- `GET /` or `/docs` - API documentation HTML
- `GET /health` - Health check
- `POST /research` - Main research endpoint (returns immediately with `status: "in_progress"` for background deep research)
- `GET /research/:responseId` - Resume/poll a background deep research job until completion
  - Use `?wait=false` to return current status immediately without server-side polling
- `GET /status/:responseId` - Get current status of a response (no polling)
- `POST /cancel/:responseId` - Cancel an in-progress response

### Deep Research Background Mode
Deep research with `background: true` returns immediately with `status: "in_progress"` and a `response_id`.
The client is responsible for polling `GET /research/:responseId?wait=false` to check completion status.
This design avoids Cloudflare's subrequest limits (50 free tier, 1000 paid tier).

### Research Pipeline
The `deepResearchAgent` function orchestrates a 5-stage pipeline:

1. **Planner** (`planner`) - Generates 6-10 search queries and stop conditions
2. **Web Search** (`webSearch`) - Multi-round searches using OpenAI's `web_search_preview` tool
3. **Fact Extraction** (`extractFacts`) - Extracts atomic facts with confidence scores from snippets
4. **Synthesis** (`synthesize`) - Combines facts into answer with `[F#]` citations
5. **Validation** (`validate`) - Verifies all claims are supported by facts

### Key Functions
- `openaiResponsesCreate` - Calls OpenAI Responses API (`/v1/responses`)
- `buildTools` - Constructs tools array (web_search, code_interpreter for deep research)
- `buildPayloadOptions` - Builds common API options (temperature, reasoning, background mode)
- `domainQualityScore` - Scores source quality (5=.gov/.edu, 1=social media)

### Supported Models
- Standard: gpt-4o, gpt-4o-mini, gpt-4.1, gpt-5.x
- Reasoning: o1, o3, o4-mini (use `reasoning_effort` param)
- Deep Research: o3-deep-research, o4-mini-deep-research (use `background: true`, supports `codeInterpreter`)

## Environment Variables
- `OPENAI_API_KEY` (secret) - Required for OpenAI API access
- `RECRUITER_API_KEY` (secret) - Required for /research endpoint access (share with recruiters)
- `OPENAI_MODEL` (var) - Default model, set in wrangler.toml

## Authentication
The `/research` endpoint is protected with an API key. Clients must include:
```
X-API-Key: <RECRUITER_API_KEY value>
```
The test.html UI prompts for this password and stores it in localStorage.

## Files
- `src/worker.js` - Main worker code (~1200 lines)
- `wrangler.toml` - Cloudflare Worker configuration
- `test.html` - Browser-based test UI with all options exposed (includes Check Status button for resuming failed jobs)
