# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Clarity generates Excalidraw architecture diagrams from Infrastructure-as-Code files. Parses Docker Compose and Helm charts into an intermediate graph representation, optionally enhances with LLM metadata, and renders hand-drawn style Excalidraw diagrams.

## Commands

```bash
# Install dependencies
bun install

# Run CLI directly (no build needed)
bun run clarity <command>

# Build all packages
bun run build

# Run tests (Bun's native test runner)
bun test

# Run a single test file
bun test packages/core/src/llm/client.test.ts

# Run tests matching a pattern
bun test --grep "enhance"

# Lint and format
bun run lint
bun run format
```

### CLI Usage

```bash
bun run clarity fetch <project> --repo <url>   # Download IaC files
bun run clarity list                            # List configured projects
bun run clarity run <project> [--step <name>]  # Execute pipeline
bun run clarity inspect <project> --run <id>   # View previous run
bun run clarity config set-key <key>           # Set OpenRouter API key
bun run clarity config show                    # Show current config
```

### Configuration

API key can be set via CLI (`clarity config set-key`) or environment variable `OPENROUTER_API_KEY`. Config stored at `~/.config/clarity/config.json`.

## Architecture

### Pipeline Stages

The pipeline (packages/core/src/pipeline/index.ts) runs these steps in sequence:

1. **parse** - Converts IaC files to `InfraGraph` (Docker Compose and Helm parsers)
2. **enhance** - Uses OpenRouter API to add service descriptions and group metadata
3. **layout** - Runs ELK layout algorithm to compute node positions
4. **generate** - Creates Excalidraw JSON and renders PNG via Puppeteer

Each step saves outputs to `test-data/<project>/runs/<runId>/` with numbered prefixes.

### Intermediate Graph

All IaC formats normalize to `InfraGraph` (packages/core/src/graph/):
- `ServiceNode[]` - Services with type, category, ports, volumes, environment
- `DependencyEdge[]` - Connections between services
- Validated at runtime with Zod schemas in `schema.ts`

### ELK Layout Engine

The ELK module (packages/core/src/elk/) handles automatic diagram layout:
- `convert.ts` - Converts `InfraGraph` to ELK format with semantic layering
- `layout.ts` - Runs ELK.js to compute x/y positions for all nodes
- Services are assigned to layers (ui → api → worker → data → infrastructure)
- Group containers maintain proper nesting for compound node layouts

### Excalidraw Rendering

The rendering system (packages/core/src/excalidraw/):
- `elk-render.ts` - Primary renderer using ELK positions
- `render.ts` - Fallback grouped/basic rendering without ELK
- Uses Excalidraw's native `elbowed: true` for 90-degree arrow routing
- ESM-loaded via esm.sh with React import maps in Puppeteer
- Text centered in containers using `containerId` positioning

### Package Structure

```
packages/
├── core/          # Pipeline logic, parsers, LLM client, Excalidraw generation
│   ├── parsers/   # IaC parsers (docker-compose.ts, helm/)
│   ├── graph/     # InfraGraph types, Zod schemas
│   ├── pipeline/  # Orchestration and run storage
│   ├── config/    # API key management (~/.config/clarity/)
│   ├── llm/       # OpenRouter client and enhancement prompts
│   ├── elk/       # ELK layout conversion and execution
│   ├── excalidraw/# Excalidraw JSON generation, PNG rendering
│   └── output/    # PNG (Puppeteer) and Mermaid debug output
└── cli/           # Commander.js CLI (fetch, run, list, inspect, config)
```

### Run Storage

Pipeline runs stored in timestamped directories under `test-data/<project>/runs/`:
- `meta.json` - Run metadata, timing, status
- `01-parsed.json` - Graph after parsing
- `02-enhanced.json` - Graph after LLM enhancement
- `03-elk-input.json` / `03-elk-output.json` - ELK layout data
- `diagram.excalidraw` / `diagram.png` - Final outputs

## Code Style

- Tab indentation (configured in biome.jsonc)
- Semicolons only as needed
- Tests use Bun's native test runner with `describe`/`test`/`expect`
- Integration tests for LLM code use `.integration.test.ts` suffix
