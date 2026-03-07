# Deep Research Agent API

![JavaScript](https://img.shields.io/badge/JavaScript-ES_Modules-F7DF1E?logo=javascript&logoColor=black)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-Edge-F38020?logo=cloudflare&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-Responses_API-412991?logo=openai&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

A production-deployed AI research agent running on Cloudflare's global edge network (300+ data centers). Performs multi-round web research with source quality scoring, conflict detection, and hallucination mitigation — delivering citation-backed answers, not just summaries.

> **LIVE & DEPLOYED:** https://deep-research-agent.vetapp.workers.dev/docs

## What It Does

Ask a question, get a research-analyst-level answer with sources:

```bash
curl -X POST "https://deep-research-agent.vetapp.workers.dev/research" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"question": "What is the OpenAI Responses API?"}'
```

**Response includes:**
- Synthesized answer with inline citations `[F1]`, `[F2]`...
- Fact table with source URLs, confidence scores, and quality ratings
- Detected conflicts between sources
- Full execution trace for debugging

## Key Features

| Feature | Description |
|---------|-------------|
| **Multi-Round Research** | Iteratively searches, extracts facts, and stops when coverage is sufficient |
| **Source Quality Scoring** | Ranks sources (5 = .gov/.edu, 4 = official docs, 1 = social media) |
| **Fact Validation** | Verifies all claims in the final answer are supported by extracted evidence |
| **Conflict Detection** | Identifies when sources contradict each other |
| **Deep Research Mode** | Supports OpenAI's o3-deep-research for 100+ source comprehensive reports |
| **API Key Protection** | Secure access control for the research endpoint |

## Authentication

The `/research` endpoint requires an API key. Contact me to request access.

Public endpoints (`/docs`, `/health`) remain accessible without authentication.

## Tech Stack

- **Runtime:** Cloudflare Workers (edge computing, globally distributed)
- **AI:** OpenAI Responses API with web_search_preview tool
- **Language:** JavaScript (ES Modules)
- **Deployment:** Wrangler CLI

## Architecture

```
Request → Planner → Web Search (multi-round) → Fact Extraction → Synthesis → Validation → Response
            ↓              ↓                         ↓
      Generate         OpenAI                   Score facts
      queries        web_search                 by source
                       tool                     quality
```

**Pipeline Stages:**
1. **Planner** - Generates 6-10 targeted search queries
2. **Web Search** - Executes searches via OpenAI's built-in web tool
3. **Fact Extraction** - Pulls atomic, verifiable facts with confidence scores
4. **Synthesis** - Combines facts into coherent answer with citations
5. **Validation** - Ensures all claims are evidence-backed

## API Options

| Parameter | Description |
|-----------|-------------|
| `model` | gpt-4o, gpt-5.2, o3-deep-research, etc. |
| `maxSearchRounds` | Number of search iterations (1-10) |
| `maxFacts` | Maximum facts to collect (5-50) |
| `temperature` | Sampling temperature (0-2) |
| `forceDomains` | Restrict to specific domains ([".gov", ".edu"]) |
| `userLocation` | Localized results ({country: "US", city: "NYC"}) |
| `background` | Async mode for deep research (10-30 min tasks) |
| `codeInterpreter` | Enable Python analysis for deep research |

## Quick Start

```bash
# Clone and install
git clone https://github.com/va2ai/deep-research-agent.git
cd deep-research-agent
npm install

# Set your OpenAI API key
wrangler secret put OPENAI_API_KEY

# Deploy
npm run deploy
```

## Test Interface

Open `test.html` in a browser for a full-featured testing UI with:
- Password-protected access (uses your API key)
- Model selection (20+ models including deep research)
- All configurable parameters
- Real-time debug logs
- Formatted results with fact tables

## What Makes This Different

| Capability | Why It Matters |
|---|---|
| **Multi-Round Research** | Iteratively refines searches instead of single-shot retrieval — catches what one query misses |
| **Source Quality Scoring** | Ranks citations by authority (.gov=5, docs=4, social=1) — not all sources are equal |
| **Conflict Detection** | Flags when sources contradict each other — prevents confident wrong answers |
| **Live Production Deployment** | Running on Cloudflare's edge, not a local demo — globally distributed, low-latency |

## Skills Demonstrated

- **Edge Computing & Serverless Architecture** — Cloudflare Workers, globally distributed, zero cold starts
- **AI Agent Design** — Multi-round research pipeline with progressive refinement and coverage checks
- **Source Validation & Hallucination Mitigation** — Quality scoring, conflict detection, evidence-backed synthesis
- **API Design & Authentication** — RESTful endpoints, API key protection, comprehensive configuration options
- **OpenAI API Integration** — Responses API, web_search tool use, multi-turn orchestration, deep research mode

## License

MIT
