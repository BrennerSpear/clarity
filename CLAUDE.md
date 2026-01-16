# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Clarity generates Excalidraw architecture diagrams from Infrastructure-as-Code files. Parses Docker Compose and Helm charts into an intermediate graph representation, optionally enhances with LLM metadata, and renders hand-drawn style Excalidraw diagrams.

## Commands

```bash
# Install dependencies
bun install

# Run CLI directly (no build needed)
bun run clarity [path]

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
# Local development (run from repo root)
bun run clarity                              # Process current directory
bun run clarity ./docker-compose.yml         # Process specific file
bun run clarity ./charts/my-app/             # Process Helm chart
bun run clarity -o ./output/                 # Custom output directory
bun run clarity --no-llm --no-png            # Skip LLM and PNG
bun run clarity config set-key <key>         # Set OpenRouter API key
bun run clarity config show                  # Show current config

# When installed via npm
iac-diagrams [path] [options]
iac-diagrams config set-key <key>
```

### Configuration

API key can be set via CLI (`iac-diagrams config set-key`) or environment variable `OPENROUTER_API_KEY`. Config stored at `~/.config/clarity/config.json`.

### npm Publishing

The CLI is published to npm as `@clarity-tools/cli`:

```bash
# Build CLI for distribution
cd packages/cli && bun run build

# Publish (requires npm login with access to @clarity-tools org)
cd packages/cli && npm publish
```

The package bundles the core library and targets Node.js 18+. Users install with:
```bash
npm install -g @clarity-tools/cli
iac-diagrams --help
```

## Architecture

### Pipeline Stages

The pipeline runs these steps in sequence:

1. **parse** - Converts IaC files to `InfraGraph` (Docker Compose and Helm parsers)
2. **enhance** - Uses OpenRouter API to add service descriptions and group metadata
3. **layout** - Runs ELK layout algorithm to compute node positions
4. **generate** - Creates Excalidraw JSON and renders PNG via Puppeteer

Output files are saved to the specified output directory (default: `./docs/diagrams/`).

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
├── core/          # @clarity-tools/core - Pipeline logic, parsers, rendering
│   ├── parsers/   # IaC parsers (docker-compose.ts, helm/)
│   ├── graph/     # InfraGraph types, Zod schemas
│   ├── pipeline/  # Orchestration (internal project storage)
│   ├── config/    # API key management (~/.config/clarity/)
│   ├── llm/       # OpenRouter client and enhancement prompts
│   ├── elk/       # ELK layout conversion and execution
│   ├── excalidraw/# Excalidraw JSON generation, PNG rendering
│   └── output/    # PNG (Puppeteer) and Mermaid debug output
└── cli/           # @clarity-tools/cli - Commander.js CLI
    └── src/
        ├── index.ts      # Main entry point
        ├── generate.ts   # Core generation logic
        └── commands/     # Subcommands (config)
```

## Code Style

- Tab indentation (configured in biome.jsonc)
- Semicolons only as needed
- Tests use Bun's native test runner with `describe`/`test`/`expect`
- Integration tests for LLM code use `.integration.test.ts` suffix
