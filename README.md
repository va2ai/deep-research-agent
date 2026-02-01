# Deep Research Agent API

A production-ready AI research assistant API built on Cloudflare Workers that performs comprehensive web research, synthesizes findings, and delivers citation-backed answers.

**Live Demo:** https://deep-research-agent.vetapp.workers.dev/docs

## What It Does

Ask a question, get a research-analyst-level answer with sources:

```bash
curl -X POST "https://deep-research-agent.vetapp.workers.dev/research" \
  -H "Content-Type: application/json" \
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
git clone https://github.com/YOUR_USERNAME/deep-research-agent.git
cd deep-research-agent
npm install

# Set your OpenAI API key
wrangler secret put OPENAI_API_KEY

# Deploy
npm run deploy
```

## Test Interface

Open `test.html` in a browser for a full-featured testing UI with:
- Model selection (20+ models including deep research)
- All configurable parameters
- Real-time debug logs
- Formatted results with fact tables

## Skills Demonstrated

- **API Design** - RESTful endpoints with comprehensive options
- **AI Integration** - OpenAI Responses API, tool use, multi-turn orchestration
- **Edge Computing** - Cloudflare Workers, serverless architecture
- **Data Pipeline** - Multi-stage processing with quality scoring
- **Error Handling** - Graceful degradation, validation, conflict detection

## License

MIT
