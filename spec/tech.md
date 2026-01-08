# Technical Specification

## Overview

TypeScript monorepo with shared pipeline core, CLI interface, and lightweight web UI for viewing intermediate outputs.

---

## Project Structure

```
infra-to-excalidraw/
├── package.json              # Workspace root (with "workspaces" field)
├── bunfig.toml               # Bun configuration
├── turbo.json                # Build orchestration
├── biome.jsonc
│
├── packages/
│   ├── core/                 # Pipeline logic (shared)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── pipeline/
│   │   │   │   ├── index.ts
│   │   │   │   ├── fetch.ts        # Download IaC files from repos
│   │   │   │   ├── parse.ts        # Parse to intermediate graph
│   │   │   │   ├── enhance.ts      # LLM categorization/grouping
│   │   │   │   ├── generate.ts     # Excalidraw JSON output
│   │   │   │   └── validate.ts     # Visual validation via Claude Vision
│   │   │   ├── parsers/
│   │   │   │   ├── index.ts
│   │   │   │   ├── docker-compose.ts
│   │   │   │   ├── helm.ts
│   │   │   │   ├── terraform.ts
│   │   │   │   └── ansible.ts
│   │   │   ├── graph/
│   │   │   │   ├── types.ts        # Intermediate representation types
│   │   │   │   ├── schema.ts       # Zod validation schemas
│   │   │   │   └── builder.ts
│   │   │   ├── excalidraw/
│   │   │   │   ├── types.ts        # Excalidraw JSON schema types
│   │   │   │   ├── layout.ts       # Auto-layout algorithm
│   │   │   │   └── render.ts       # Generate Excalidraw JSON
│   │   │   ├── output/
│   │   │   │   ├── mermaid.ts      # Optional Mermaid debug output
│   │   │   │   └── png.ts          # Puppeteer PNG rendering
│   │   │   └── llm/
│   │   │       ├── client.ts       # Claude API client
│   │   │       └── prompts.ts      # Enhancement prompts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── cli/                  # Command-line interface
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── commands/
│   │   │   │   ├── fetch.ts
│   │   │   │   ├── run.ts
│   │   │   │   ├── list.ts
│   │   │   │   └── inspect.ts
│   │   │   └── utils/
│   │   │       └── output.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                  # Lightweight viewer UI
│       ├── src/
│       │   ├── app/
│       │   │   ├── page.tsx              # Project list
│       │   │   ├── [project]/
│       │   │   │   ├── page.tsx          # Run list for project
│       │   │   │   └── [runId]/
│       │   │   │       └── page.tsx      # Pipeline step viewer
│       │   │   └── api/
│       │   │       ├── projects/route.ts
│       │   │       ├── runs/route.ts
│       │   │       └── pipeline/route.ts # Trigger pipeline runs
│       │   └── components/
│       │       ├── StepViewer.tsx
│       │       ├── GraphPreview.tsx
│       │       ├── ExcalidrawPreview.tsx
│       │       ├── ValidationResults.tsx
│       │       └── DiffView.tsx
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
│   │           ├── 02-enhanced.json
│   │           ├── 03-excalidraw.json
│   │           └── 03-excalidraw.png   # Optional rendered preview
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

export interface InfraGraph {
  nodes: ServiceNode[]
  edges: DependencyEdge[]
  metadata: GraphMetadata
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
  environment?: Record<string, string>
  replicas?: number

  // LLM-enhanced
  category?: ServiceCategory
  description?: string
  group?: string
}

export type ServiceType =
  | "container"
  | "database"
  | "cache"
  | "queue"
  | "storage"
  | "proxy"
  | "application"

export type ServiceCategory =
  | "data-layer"
  | "application-layer"
  | "infrastructure"
  | "monitoring"
  | "security"

export interface DependencyEdge {
  from: string
  to: string
  type: DependencyType
  port?: number
  protocol?: string
}

export type DependencyType =
  | "depends_on"
  | "network"
  | "volume"
  | "link"
  | "inferred"

export interface SourceInfo {
  file: string
  format: "docker-compose" | "helm" | "terraform" | "ansible"
  line?: number
}

export interface GraphMetadata {
  project: string
  parsedAt: string
  sourceFiles: string[]
  parserVersion: string
}
```

### Zod Validation Schemas

```typescript
// packages/core/src/graph/schema.ts

import { z } from "zod"

export const ServiceNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(["container", "database", "cache", "queue", "storage", "proxy", "application"]),
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
  environment: z.record(z.string()).optional(),
  replicas: z.number().optional(),
  category: z.enum(["data-layer", "application-layer", "infrastructure", "monitoring", "security"]).optional(),
  description: z.string().optional(),
  group: z.string().optional(),
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

### Mermaid Debug Output

```typescript
// packages/core/src/output/mermaid.ts

import type { InfraGraph } from "../graph/schema"

export function graphToMermaid(graph: InfraGraph): string {
  const lines = ["flowchart TB"]

  // Group nodes by category if available
  const grouped = groupByCategory(graph.nodes)

  for (const [category, nodes] of Object.entries(grouped)) {
    if (category !== "ungrouped") {
      lines.push(`  subgraph ${category}`)
    }
    for (const node of nodes) {
      const shape = getNodeShape(node.type)
      lines.push(`    ${node.id}${shape.open}${node.name}${shape.close}`)
    }
    if (category !== "ungrouped") {
      lines.push("  end")
    }
  }

  for (const edge of graph.edges) {
    const label = edge.port ? `|:${edge.port}|` : ""
    lines.push(`  ${edge.from} -->${label} ${edge.to}`)
  }

  return lines.join("\n")
}

function getNodeShape(type: string): { open: string; close: string } {
  switch (type) {
    case "database": return { open: "[(", close: ")]" }
    case "cache": return { open: "((", close: "))" }
    case "queue": return { open: "[/", close: "/]" }
    default: return { open: "[", close: "]" }
  }
}
```

### PNG Rendering

```typescript
// packages/core/src/output/png.ts

import puppeteer from "puppeteer"

export async function renderExcalidrawToPng(
  excalidrawJson: string,
  outputPath: string
): Promise<void> {
  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()

  // Load minimal HTML with Excalidraw
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <script src="https://unpkg.com/@excalidraw/excalidraw/dist/excalidraw.production.min.js"></script>
      </head>
      <body>
        <div id="app" style="width: 1920px; height: 1080px;"></div>
        <script>
          const data = ${excalidrawJson};
          ExcalidrawLib.exportToBlob({
            elements: data.elements,
            appState: { exportBackground: true, viewBackgroundColor: "#ffffff" },
          }).then(blob => {
            window.renderedBlob = blob;
          });
        </script>
      </body>
    </html>
  `)

  // Wait for render and save
  await page.waitForFunction(() => window.renderedBlob)
  const blob = await page.evaluate(() => window.renderedBlob.arrayBuffer())
  await Bun.write(outputPath, new Uint8Array(blob))

  await browser.close()
}
```

### Visual Validation (Claude Vision)

```typescript
// packages/core/src/pipeline/validate.ts

import Anthropic from "@anthropic-ai/sdk"
import type { InfraGraph } from "../graph/schema"

export interface ValidationResult {
  valid: boolean
  issues: string[]
  suggestions: string[]
  scores: {
    completeness: number  // 0-100: Are all expected nodes visible?
    clarity: number       // 0-100: Is the layout clear and readable?
    connections: number   // 0-100: Are edges clear and not overlapping?
    grouping: number      // 0-100: Is logical grouping evident?
  }
}

export async function validateDiagram(
  pngPath: string,
  graph: InfraGraph,
  client: Anthropic
): Promise<ValidationResult> {
  const imageData = await Bun.file(pngPath).arrayBuffer()
  const base64 = Buffer.from(imageData).toString("base64")

  const expectedServices = graph.nodes.map(n => n.name).join(", ")
  const expectedConnections = graph.edges.length

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: base64 }
        },
        {
          type: "text",
          text: `Validate this infrastructure diagram.

Expected:
- ${graph.nodes.length} services: ${expectedServices}
- ${expectedConnections} connections between services

Evaluate:
1. COMPLETENESS: Are all ${graph.nodes.length} services visible and labeled?
2. CLARITY: Is the text readable? Are boxes appropriately sized?
3. CONNECTIONS: Are the ${expectedConnections} edges clear? Any overlapping lines?
4. GROUPING: Are related services (databases, caches, app servers) visually grouped?

Return JSON only:
{
  "valid": boolean,
  "issues": ["list of problems found"],
  "suggestions": ["list of improvements"],
  "scores": {
    "completeness": 0-100,
    "clarity": 0-100,
    "connections": 0-100,
    "grouping": 0-100
  }
}`
        }
      ]
    }]
  })

  const text = response.content[0].type === "text" ? response.content[0].text : ""
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error("Failed to parse validation response")
  }

  return JSON.parse(jsonMatch[0]) as ValidationResult
}

// Validation thresholds
export const VALIDATION_THRESHOLDS = {
  minimumScore: 70,        // Individual score minimum
  minimumAverage: 80,      // Average across all scores
  requiredValid: true,     // Must pass basic validity check
}

export function isValidationPassing(result: ValidationResult): boolean {
  const scores = Object.values(result.scores)
  const average = scores.reduce((a, b) => a + b, 0) / scores.length
  const allAboveMinimum = scores.every(s => s >= VALIDATION_THRESHOLDS.minimumScore)

  return (
    result.valid &&
    allAboveMinimum &&
    average >= VALIDATION_THRESHOLDS.minimumAverage
  )
}
```

### Pipeline Interface

```typescript
// packages/core/src/pipeline/index.ts

export interface PipelineConfig {
  project: string
  steps?: PipelineStep[]
  outputDir: string
  llm?: {
    enabled: boolean
    model?: string
  }
  excalidraw?: {
    resolutionLevels: ResolutionLevel[]
    theme?: "light" | "dark"
  }
}

export type PipelineStep = "fetch" | "parse" | "enhance" | "generate" | "validate"

export type ResolutionLevel = "executive" | "groups" | "services" | "detailed"

export interface PipelineRun {
  id: string
  project: string
  startedAt: string
  completedAt?: string
  status: "running" | "completed" | "failed"
  steps: StepResult[]
}

export interface StepResult {
  step: PipelineStep
  status: "pending" | "running" | "completed" | "failed"
  startedAt?: string
  completedAt?: string
  outputFile?: string
  error?: string
}

export async function runPipeline(config: PipelineConfig): Promise<PipelineRun>
export async function runStep(config: PipelineConfig, step: PipelineStep): Promise<StepResult>
```

---

## CLI Commands

```bash
# Fetch IaC files from a repository
ite fetch sentry --repo https://github.com/getsentry/self-hosted

# List configured projects
ite list

# Run full pipeline
ite run sentry

# Run specific step
ite run sentry --step parse

# Run with specific resolution levels
ite run sentry --levels executive,services

# Inspect a previous run
ite inspect sentry --run 2024-01-08-143022

# Compare two runs
ite diff sentry --runs 2024-01-08-143022,2024-01-08-152044
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
  .name("ite")
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
        { "path": "docker-compose.yml", "format": "docker-compose" },
        { "path": "docker-compose-postgres.yml", "format": "docker-compose" }
      ],
      "helmRepo": "https://github.com/temporalio/helm-charts",
      "helmFiles": [
        { "path": "charts/temporal/values.yaml", "format": "helm" }
      ]
    },
    {
      "id": "mastodon",
      "name": "Mastodon",
      "repo": "https://github.com/mastodon/mastodon",
      "files": [
        { "path": "docker-compose.yml", "format": "docker-compose" }
      ],
      "helmRepo": "https://github.com/mastodon/chart",
      "ansibleRepo": "https://github.com/mastodon/mastodon-ansible"
    }
  ]
}
```

---

## Web UI

Minimal Next.js app for viewing pipeline runs and outputs.

### Pages

1. **`/`** - Project list with last run status
2. **`/[project]`** - List of runs for a project, trigger new run
3. **`/[project]/[runId]`** - Step-by-step viewer with:
   - Parsed graph visualization
   - Enhanced graph with LLM annotations
   - Excalidraw preview (embedded or iframe)
   - Raw JSON viewers for each step
   - Diff against previous run

### API Routes (import from core)

```typescript
// packages/web/src/app/api/pipeline/route.ts

import { runPipeline, type PipelineConfig } from "@ite/core"

export async function POST(request: Request) {
  const config: PipelineConfig = await request.json()

  // Same pipeline code used by CLI
  const run = await runPipeline(config)

  return Response.json(run)
}
```

### Key Components

```typescript
// packages/web/src/components/StepViewer.tsx

interface StepViewerProps {
  run: PipelineRun
  step: PipelineStep
}

// Shows step status, timing, and output
// Tabs for: Preview | Raw JSON | Diff
```

```typescript
// packages/web/src/components/ExcalidrawPreview.tsx

interface ExcalidrawPreviewProps {
  excalidrawJson: string
  level: ResolutionLevel
}

// Renders Excalidraw using @excalidraw/excalidraw package
// Read-only preview mode
```

---

## Pipeline Run Storage

Each run creates a timestamped directory:

```
test-data/sentry/runs/2024-01-08-143022/
├── meta.json                               # Run metadata, timing, status
├── 01-parsed.json                          # InfraGraph after parsing
├── 01-parsed.mermaid                       # Optional Mermaid debug output
├── 02-enhanced.json                        # InfraGraph after LLM enhancement
├── 02-enhanced.mermaid                     # Optional Mermaid with categories
├── 03-excalidraw-executive.json            # Excalidraw JSON
├── 03-excalidraw-executive.png             # Rendered PNG preview
├── 03-excalidraw-services.json
├── 03-excalidraw-services.png
├── 04-validation-executive.json            # Vision QA results per level
├── 04-validation-services.json
└── 04-validation-summary.json              # Overall pass/fail + aggregated scores
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
      "outputFile": "01-parsed.json"
    },
    {
      "step": "enhance",
      "status": "completed",
      "duration": 8500,
      "outputFile": "02-enhanced.json",
      "llmModel": "claude-sonnet-4-20250514",
      "tokensUsed": 2340
    },
    {
      "step": "generate",
      "status": "completed",
      "duration": 350,
      "outputFiles": [
        "03-excalidraw-executive.json",
        "03-excalidraw-executive.png",
        "03-excalidraw-services.json",
        "03-excalidraw-services.png"
      ]
    },
    {
      "step": "validate",
      "status": "completed",
      "duration": 12500,
      "outputFiles": [
        "04-validation-executive.json",
        "04-validation-services.json",
        "04-validation-summary.json"
      ],
      "llmModel": "claude-sonnet-4-20250514",
      "tokensUsed": 1820,
      "validationPassed": true,
      "averageScore": 87
    }
  ],
  "sourceFiles": ["docker-compose.yml"],
  "config": {
    "resolutionLevels": ["executive", "services"],
    "llmEnabled": true,
    "validationEnabled": true
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
| **Web Framework** | Next.js 16 (App Router) | File-based routing, API routes, Turbopack |
| **Styling** | Tailwind | Quick iteration, matches your stack |
| **YAML Parsing** | yaml | Standard YAML parsing |
| **Validation** | Zod | Runtime schema validation with TypeScript inference |
| **LLM** | @anthropic-ai/sdk | Claude API |
| **Excalidraw** | @excalidraw/excalidraw | Embed and generate |
| **PNG Rendering** | Puppeteer | Headless browser for Excalidraw → PNG |
| **Linting** | Biome | Fast, matches your preferences |

---

## Development Workflow

```bash
# Install dependencies
bun install

# Development (runs all packages in watch mode)
bun run dev

# Run CLI during development
bun run --cwd packages/cli dev -- run sentry

# Build all packages
bun run build

# Run the CLI (after build)
bun run ite run sentry

# Run web UI
bun run --cwd packages/web dev

# Run tests
bun test
```

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Initialize monorepo structure
- [ ] Set up core package with types
- [ ] Implement docker-compose parser
- [ ] Basic CLI with `fetch` and `run` commands
- [ ] File-based run storage

### Phase 2: Pipeline
- [ ] Intermediate graph builder
- [ ] Excalidraw JSON generator (single resolution)
- [ ] Basic layout algorithm
- [ ] `inspect` CLI command

### Phase 3: LLM Enhancement
- [ ] Claude API integration
- [ ] Service categorization prompts
- [ ] Grouping and labeling
- [ ] Multiple resolution levels

### Phase 4: PNG Rendering & Visual Validation
- [ ] Puppeteer integration for PNG export
- [ ] Claude Vision validation implementation
- [ ] Validation scoring and thresholds
- [ ] Re-generation loop on validation failure (optional)
- [ ] Mermaid debug output

### Phase 5: Web UI
- [ ] Project list page
- [ ] Run viewer with step navigation
- [ ] Excalidraw preview component
- [ ] Validation results display
- [ ] Trigger runs from UI

### Phase 6: Additional Parsers
- [ ] Helm chart parser
- [ ] Terraform parser
- [ ] Cross-format validation

---

## Design Decisions

| Decision | Choice | Notes |
|----------|--------|-------|
| **Test data storage** | Git-tracked | Easy to diff runs, share test cases, see history |
| **LLM provider** | Claude only | Simpler, Anthropic SDK already available |
| **Image output** | JSON + PNG | Generate static previews via Puppeteer |
| **Mermaid output** | Yes, optional | ~20 lines, useful for quick validation |

## Open Questions

1. **Excalidraw layout algorithm** - Use existing library (dagre, elkjs) or custom?
2. **LLM caching** - Cache enhancement results to avoid re-running for unchanged graphs?
