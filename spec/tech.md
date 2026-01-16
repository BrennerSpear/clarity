# Technical Specification

## Overview

TypeScript monorepo with shared pipeline core and CLI interface. Generates Excalidraw architecture diagrams from Infrastructure-as-Code files.

---

## Project Structure

```
clarity/
├── package.json              # Workspace root (with "workspaces" field)
├── bunfig.toml               # Bun configuration
├── turbo.json                # Build orchestration
├── biome.jsonc               # Linting and formatting
│
├── packages/
│   ├── core/                 # Pipeline logic (shared)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── pipeline/
│   │   │   │   ├── index.ts      # Pipeline orchestration
│   │   │   │   ├── storage.ts    # Run storage utilities
│   │   │   │   └── types.ts      # Pipeline config and run types
│   │   │   ├── parsers/
│   │   │   │   ├── index.ts
│   │   │   │   └── docker-compose.ts
│   │   │   ├── graph/
│   │   │   │   ├── types.ts      # Intermediate representation types
│   │   │   │   ├── schema.ts     # Zod validation schemas
│   │   │   │   ├── builder.ts    # Fluent graph builder
│   │   │   │   └── grouping.ts   # Service grouping logic
│   │   │   ├── elk/
│   │   │   │   ├── types.ts      # ELK graph types
│   │   │   │   ├── convert.ts    # InfraGraph to ELK conversion
│   │   │   │   ├── layout.ts     # ELK layout execution
│   │   │   │   └── elk-layout-runner.cjs  # CJS subprocess runner
│   │   │   ├── excalidraw/
│   │   │   │   ├── types.ts      # Excalidraw JSON schema types
│   │   │   │   ├── render.ts     # Basic and grouped rendering
│   │   │   │   ├── elk-render.ts # Primary ELK-based renderer
│   │   │   │   ├── layout.ts     # Fallback layout algorithm
│   │   │   │   ├── semantic-layout.ts  # Role-based positioning
│   │   │   │   └── pathfinding.ts      # Arrow routing utilities
│   │   │   ├── output/
│   │   │   │   ├── mermaid.ts    # Mermaid debug output
│   │   │   │   └── png.ts        # Puppeteer PNG rendering
│   │   │   └── llm/
│   │   │       ├── client.ts     # Claude API client
│   │   │       └── prompts.ts    # Enhancement prompts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── cli/                  # Command-line interface
│       ├── src/
│       │   ├── index.ts
│       │   ├── commands/
│       │   │   ├── fetch.ts
│       │   │   ├── run.ts
│       │   │   ├── list.ts
│       │   │   └── inspect.ts
│       │   └── utils/
│       │       └── output.ts
│       ├── package.json
│       └── tsconfig.json
│
├── test-data/                # Downloaded IaC files
│   ├── sentry/
│   │   ├── source/           # Raw fetched files
│   │   │   └── docker-compose.yml
│   │   └── runs/             # Pipeline run outputs
│   │       └── 2024-01-08-143022/
│   │           ├── meta.json
│   │           ├── 01-parsed.json
│   │           ├── 01-parsed.mermaid
│   │           ├── 02-enhanced.json
│   │           ├── 02-enhanced.mermaid
│   │           ├── 03-elk-input.json
│   │           ├── 03-elk-output.json
│   │           ├── diagram.excalidraw
│   │           ├── diagram.png
│   │           ├── 04-validation-services.json
│   │           └── 04-validation-summary.json
│   ├── temporal/
│   ├── mastodon/
│   └── gitlab/
│
├── projects.json             # Registry of configured projects
│
└── spec/
    ├── research.md
    └── tech.md
```

---

## Core Package

### Intermediate Graph Schema

```typescript
// packages/core/src/graph/types.ts

export type ServiceType =
  | "container"
  | "database"
  | "cache"
  | "queue"
  | "storage"
  | "proxy"
  | "ui"

export type QueueRole = "producer" | "consumer" | "both"

export type DependencyType =
  | "depends_on"
  | "network"
  | "volume"
  | "link"
  | "inferred"

export type SourceFormat = "docker-compose" | "helm" | "terraform" | "ansible"

export interface PortMapping {
  internal: number
  external?: number
}

export interface VolumeMount {
  source: string
  target: string
  type?: "volume" | "bind" | "tmpfs"
}

export interface SourceInfo {
  file: string
  format: SourceFormat
  line?: number
}

export interface ServiceNode {
  id: string
  name: string
  type: ServiceType
  source: SourceInfo

  // Parsed from IaC
  image?: string
  ports?: PortMapping[]
  volumes?: VolumeMount[]
  environment?: Record<string, string | number | boolean | null>
  replicas?: number

  // LLM-enhanced
  description?: string
  group?: string
  queueRole?: QueueRole
}

export interface DependencyEdge {
  from: string
  to: string
  type: DependencyType
  port?: number
  protocol?: string
}

export interface GraphMetadata {
  project: string
  parsedAt: string
  sourceFiles: string[]
  parserVersion: string
}

export interface InfraGraph {
  nodes: ServiceNode[]
  edges: DependencyEdge[]
  metadata: GraphMetadata
}
```

### Zod Validation Schemas

```typescript
// packages/core/src/graph/schema.ts

import { z } from "zod"

export const ServiceNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(["container", "database", "cache", "queue", "storage", "proxy", "ui"]),
  source: z.object({
    file: z.string(),
    format: z.enum(["docker-compose", "helm", "terraform", "ansible"]),
    line: z.number().optional(),
  }),
  image: z.string().optional(),
  ports: z.array(z.object({
    internal: z.number(),
    external: z.number().optional(),
  })).optional(),
  volumes: z.array(z.object({
    source: z.string(),
    target: z.string(),
    type: z.enum(["volume", "bind", "tmpfs"]).optional(),
  })).optional(),
  environment: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  replicas: z.number().optional(),
  description: z.string().optional(),
  group: z.string().optional(),
  queueRole: z.enum(["producer", "consumer", "both"]).optional(),
})

export const DependencyEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(["depends_on", "network", "volume", "link", "inferred"]),
  port: z.number().optional(),
  protocol: z.string().optional(),
})

export const InfraGraphSchema = z.object({
  nodes: z.array(ServiceNodeSchema),
  edges: z.array(DependencyEdgeSchema),
  metadata: z.object({
    project: z.string(),
    parsedAt: z.string().datetime(),
    sourceFiles: z.array(z.string()),
    parserVersion: z.string(),
  }),
}).refine(
  (graph) => {
    const nodeIds = new Set(graph.nodes.map(n => n.id))
    return graph.edges.every(e => nodeIds.has(e.from) && nodeIds.has(e.to))
  },
  { message: "Edge references non-existent node" }
).refine(
  (graph) => {
    const ids = graph.nodes.map(n => n.id)
    return new Set(ids).size === ids.length
  },
  { message: "Duplicate node IDs detected" }
)

// Type inference from schema
export type ServiceNode = z.infer<typeof ServiceNodeSchema>
export type DependencyEdge = z.infer<typeof DependencyEdgeSchema>
export type InfraGraph = z.infer<typeof InfraGraphSchema>
```

### ELK Layout Module

The ELK module handles automatic diagram layout using the ELK.js (Eclipse Layout Kernel) library.

```typescript
// packages/core/src/elk/types.ts

export type SemanticLayer = "entry" | "ui" | "api" | "worker" | "queue" | "data"

export interface ElkNode {
  id: string
  width?: number
  height?: number
  x?: number
  y?: number
  labels?: ElkLabel[]
  ports?: ElkPort[]
  layoutOptions?: Record<string, string>
  children?: ElkNode[]
}

export interface ElkEdge {
  id: string
  sources: string[]
  targets: string[]
  sections?: ElkEdgeSection[]
}

export interface ElkGraph {
  id: string
  layoutOptions?: Record<string, string>
  children: ElkNode[]
  edges: ElkEdge[]
}

// Layout option presets
export const ELK_LAYOUT_OPTIONS = {
  standard: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.spacing.nodeNode": "50",
    "elk.layered.spacing.nodeNodeBetweenLayers": "100",
  },
  semantic: {
    "elk.algorithm": "layered",
    "elk.direction": "RIGHT",
    "elk.partitioning.activate": "true",
    "elk.spacing.nodeNode": "50",
    "elk.layered.spacing.nodeNodeBetweenLayers": "100",
    "elk.edgeRouting": "ORTHOGONAL",
  },
}
```

```typescript
// packages/core/src/elk/convert.ts

/**
 * Semantic layer partitions (left to right)
 */
const LAYER_PARTITIONS: Record<SemanticLayer, number> = {
  entry: 0,   // Proxies, load balancers, external-facing
  ui: 1,      // Web frontends, UI services
  api: 2,     // API services, gateways, streaming
  worker: 3,  // Background job processors (sidekiq, celery)
  queue: 4,   // Message queues, brokers
  data: 5,    // Databases, caches, storage
}

/**
 * Determine the semantic layer for a service based on its type and name
 */
export function getSemanticLayer(node: ServiceNode): SemanticLayer {
  // Type-based rules (highest priority)
  switch (node.type) {
    case "proxy": return "entry"
    case "database":
    case "storage":
    case "cache": return "data"
    case "queue": return "queue"
  }

  // Name-based heuristics for common patterns
  const nameLower = node.name.toLowerCase()

  if (nameLower.includes("nginx") || nameLower.includes("traefik")) return "entry"
  if (nameLower === "web" || nameLower.includes("frontend")) return "ui"
  if (nameLower.includes("worker") || nameLower.includes("sidekiq")) return "worker"
  if (nameLower.includes("api") || nameLower.includes("gateway")) return "api"

  return "api"  // Default to API layer
}

/**
 * Convert InfraGraph to ELK format with semantic layering
 */
export function infraGraphToElk(
  graph: InfraGraph,
  options?: { semanticLayers?: boolean }
): ElkConversionResult
```

The conversion assigns ports per edge based on semantic layer order. Edges flowing left-to-right use source east/target west; edges that point to earlier lanes use source west/target east; edges within the same lane use source south/target north to route vertically and avoid U-turns.

The ELK layout is executed via a CJS subprocess (`elk-layout-runner.cjs`) for compatibility with ELK.js's CommonJS module format.

### Excalidraw Rendering

```typescript
// packages/core/src/excalidraw/types.ts

// Color palette for different service types
export const SERVICE_COLORS = {
  database: { stroke: "#1971c2", background: "#a5d8ff" },
  cache: { stroke: "#e03131", background: "#ffc9c9" },
  queue: { stroke: "#f08c00", background: "#ffec99" },
  storage: { stroke: "#2f9e44", background: "#b2f2bb" },
  proxy: { stroke: "#7950f2", background: "#d0bfff" },
  container: { stroke: "#495057", background: "#dee2e6" },
  ui: { stroke: "#0c8599", background: "#99e9f2" },
} as const

// Shape configuration for different service types
export const SERVICE_SHAPES: Record<string, ExcalidrawElementType> = {
  database: "ellipse",
  cache: "ellipse",
  storage: "ellipse",
  queue: "diamond",
  proxy: "rectangle",
  container: "rectangle",
  ui: "rectangle",
} as const
```

Three rendering strategies are available:

1. **ELK Renderer** (`elk-render.ts`) - Primary renderer using ELK-computed positions
2. **Grouped Renderer** (`render.ts`) - Groups services by dependency path
3. **Basic Renderer** (`render.ts`) - Simple grid layout fallback

Arrows use Excalidraw's native `elbowed: true` for 90-degree orthogonal routing. Inferred edges are rendered dashed to distinguish heuristic dependencies from explicit ones.

### Mermaid Debug Output

```typescript
// packages/core/src/output/mermaid.ts

export function graphToMermaid(graph: InfraGraph): string
export function graphToMermaidStyled(graph: InfraGraph): string  // With service colors
```

### PNG Rendering

```typescript
// packages/core/src/output/png.ts

export async function renderExcalidrawToPng(
  excalidraw: ExcalidrawFile
): Promise<Buffer>
```

Uses Puppeteer with ESM-loaded Excalidraw via esm.sh with React import maps.

### Pipeline Interface

```typescript
// packages/core/src/pipeline/types.ts

export type PipelineStep = "parse" | "enhance" | "layout" | "generate"

export type ResolutionLevel = "executive" | "groups" | "services" | "detailed"

export interface PipelineConfig {
  project: string
  steps?: PipelineStep[]
  outputDir: string
  llm?: {
    enabled: boolean
    model?: string
  }
  mermaid?: {
    enabled: boolean
  }
  png?: {
    enabled: boolean
  }
  excalidraw?: {
    resolutionLevels: ResolutionLevel[]
    theme?: "light" | "dark"
  }
}

export interface PipelineRun {
  id: string
  project: string
  startedAt: string
  completedAt?: string
  status: "running" | "completed" | "failed"
  steps: StepResult[]
  sourceFiles?: string[]
  config?: {
    llmEnabled?: boolean
    resolutionLevels?: ResolutionLevel[]
  }
}

export interface StepResult {
  step: PipelineStep
  status: "pending" | "running" | "completed" | "failed"
  startedAt?: string
  completedAt?: string
  duration?: number
  outputFile?: string
  outputFiles?: string[]
  error?: string
}
```

---

## Pipeline

The pipeline runs four steps in sequence. Each step must complete successfully or the pipeline fails.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLARITY PIPELINE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌──────────┐            │
│   │  PARSE  │────▶│ ENHANCE │────▶│  LAYOUT │────▶│ GENERATE │            │
│   └─────────┘     └─────────┘     └─────────┘     └──────────┘            │
│        │               │               │               │                   │
│        ▼               ▼               ▼               ▼                   │
│   ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌──────────┐            │
│   │ 01-parsed│     │02-enhanced│    │03-elk-*  │     │ diagram. │            │
│   │  .json  │     │  .json   │     │  .json   │     │excalidraw│            │
│   │.mermaid │     │ .mermaid │     │          │     │  .png    │            │
│   └─────────┘     └─────────┘     └─────────┘     └──────────┘            │
│                                                                             │
│   docker-compose  Claude API      ELK.js          Excalidraw               │
│   YAML parsing    enrichment      layered layout  + Puppeteer              │
│                   (optional)                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. Parse
Converts IaC files to `InfraGraph`. Currently supports docker-compose YAML.

- Handles YAML aliases and merge keys (`<<`)
- Infers service types from image names (postgres→database, redis→cache, etc.)
- Parses ports, volumes, environment variables, replicas

### 2. Enhance (optional, requires `--llm`)
Uses Claude API to add semantic information:

- Service descriptions
- Group assignments (3-5 logical groups)
- Queue roles (producer/consumer/both)

### 3. Layout
Converts InfraGraph to ELK format and computes positions:

- Assigns services to semantic layers (entry→ui→api→worker→queue→data)
- Adds port constraints for cache connections
- Uses orthogonal edge routing

### 4. Generate
Creates Excalidraw JSON and renders PNG:

- Uses ELK-computed positions
- Renders PNG via Puppeteer

---

## CLI Commands

```bash
# Fetch IaC files from a repository
clarity fetch sentry --repo https://github.com/getsentry/self-hosted

# List configured projects
clarity list
clarity list --all  # Include empty projects

# Run full pipeline
clarity run sentry

# Run with LLM disabled
clarity run sentry --no-llm

# Run specific step
clarity run sentry --step parse
clarity run sentry --step generate

# Verbose output
clarity run sentry --verbose

# Inspect a previous run
clarity inspect sentry                    # Latest run
clarity inspect sentry --run 2024-01-08-143022
clarity inspect sentry --json             # JSON output
```

### CLI Implementation

```typescript
// packages/cli/src/index.ts

import { Command } from "commander"
import { fetchCommand } from "./commands/fetch"
import { runCommand } from "./commands/run"
import { listCommand } from "./commands/list"
import { inspectCommand } from "./commands/inspect"

const program = new Command()
  .name("clarity")
  .description("Infrastructure to Excalidraw")
  .version("0.1.0")

program.addCommand(fetchCommand)
program.addCommand(runCommand)
program.addCommand(listCommand)
program.addCommand(inspectCommand)

program.parse()
```

---

## Project Registry

```json
// projects.json
{
  "projects": [
    {
      "id": "sentry",
      "name": "Sentry",
      "repo": "https://github.com/getsentry/self-hosted",
      "files": [
        { "path": "docker-compose.yml", "format": "docker-compose" }
      ]
    },
    {
      "id": "temporal",
      "name": "Temporal",
      "repo": "https://github.com/temporalio/docker-compose",
      "files": [
        { "path": "docker-compose.yml", "format": "docker-compose" }
      ]
    },
    {
      "id": "mastodon",
      "name": "Mastodon",
      "repo": "https://github.com/mastodon/mastodon",
      "files": [
        { "path": "docker-compose.yml", "format": "docker-compose" }
      ]
    }
  ]
}
```

---

## Pipeline Run Storage

Each run creates a timestamped directory:

```
test-data/sentry/runs/2024-01-08-143022/
├── meta.json                     # Run metadata, timing, status
├── 01-parsed.json                # InfraGraph after parsing
├── 01-parsed.mermaid             # Mermaid debug output
├── 02-enhanced.json              # InfraGraph after LLM enhancement
├── 02-enhanced.mermaid           # Mermaid with groups/descriptions
├── 03-elk-input.json             # ELK graph input
├── 03-elk-output.json            # ELK graph with computed positions
├── diagram.excalidraw            # Excalidraw JSON file
└── diagram.png                   # Rendered PNG preview
```

### Meta file

```json
{
  "id": "2024-01-08-143022",
  "project": "sentry",
  "startedAt": "2024-01-08T14:30:22.000Z",
  "completedAt": "2024-01-08T14:30:58.000Z",
  "status": "completed",
  "steps": [
    {
      "step": "parse",
      "status": "completed",
      "duration": 1250,
      "outputFile": "01-parsed.json",
      "outputFiles": ["01-parsed.json", "01-parsed.mermaid"]
    },
    {
      "step": "enhance",
      "status": "completed",
      "duration": 8500,
      "outputFile": "02-enhanced.json",
      "llmModel": "claude-sonnet-4-20250514"
    },
    {
      "step": "layout",
      "status": "completed",
      "duration": 450,
      "outputFile": "03-elk-output.json",
      "layers": {
        "entry": ["nginx"],
        "api": ["web", "relay"],
        "worker": ["worker", "cron"],
        "data": ["postgres", "redis", "memcached"]
      }
    },
    {
      "step": "generate",
      "status": "completed",
      "duration": 2350,
      "outputFile": "diagram.excalidraw",
      "outputFiles": ["diagram.excalidraw", "diagram.png"],
      "pngGenerated": true
    }
  ],
  "sourceFiles": ["docker-compose.yml"],
  "config": {
    "llmEnabled": true
  }
}
```

---

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Runtime** | Bun | Fast, native TypeScript, built-in test runner |
| **Package Manager** | Bun | Workspace support, fast installs |
| **Build** | Bun | Native bundling, no extra tooling |
| **Monorepo** | Bun workspaces + Turborepo | Bun for packages, Turbo for task caching |
| **CLI Framework** | Commander | Simple, well-documented |
| **YAML Parsing** | yaml | Standard YAML parsing |
| **Validation** | Zod | Runtime schema validation with TypeScript inference |
| **Layout Engine** | ELK.js | Layered graph layout with semantic partitioning |
| **LLM** | @anthropic-ai/sdk | Claude API |
| **Excalidraw** | Native JSON format | Direct JSON generation |
| **PNG Rendering** | Puppeteer | Headless browser for Excalidraw → PNG |
| **Linting** | Biome | Fast, matches your preferences |

---

## Development Workflow

```bash
# Install dependencies
bun install

# Run CLI directly (no build needed)
bun run clarity <command>

# Build all packages
bun run build

# Run tests
bun test

# Run a single test file
bun test packages/core/src/llm/client.test.ts

# Run tests matching a pattern
bun test --grep "enhance"

# Lint and format
bun run lint
bun run format
```

---

## Implementation Status

### Completed
- [x] Monorepo structure with core and cli packages
- [x] Docker-compose parser with type inference
- [x] InfraGraph types and Zod schemas
- [x] GraphBuilder fluent API
- [x] Claude API client and enhancement prompts
- [x] ELK layout module with semantic layering
- [x] Excalidraw JSON generation with shape/color differentiation
- [x] PNG rendering via Puppeteer
- [x] Mermaid debug output
- [x] CLI commands: fetch, run, list, inspect
- [x] Run storage with timestamped directories

### Not Yet Implemented
- [ ] Web UI for viewing pipeline runs
- [ ] Helm chart parser
- [ ] Terraform parser
- [ ] Ansible parser
- [ ] Multi-file docker-compose merging
- [ ] Multiple resolution levels (executive, groups, services, detailed)
- [ ] LLM response caching

---

## Design Decisions

| Decision | Choice | Notes |
|----------|--------|-------|
| **Test data storage** | Git-tracked | Easy to diff runs, share test cases |
| **LLM provider** | Claude only | Simpler, Anthropic SDK available |
| **Layout engine** | ELK.js | Layered algorithm fits architecture diagrams |
| **ELK execution** | Subprocess | CJS compatibility with ESM project |
| **Image output** | JSON + PNG | Static previews via Puppeteer |
| **Arrow routing** | Excalidraw elbowed | Native orthogonal routing |
| **Mermaid output** | Optional debug | Quick validation without PNG |

## Open Questions

1. **Multi-resolution output** - How to implement executive/groups/services/detailed views?
2. **LLM caching** - Cache enhancement results to avoid re-running for unchanged graphs?
3. **Web UI** - Lightweight viewer for pipeline runs and outputs?
