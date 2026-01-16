# @clarity-tools/cli

Generate beautiful, hand-drawn style architecture diagrams from your Infrastructure-as-Code files.

[![npm version](https://img.shields.io/npm/v/@clarity-tools/cli.svg)](https://www.npmjs.com/package/@clarity-tools/cli)

## Examples

### Temporal

![Temporal architecture](https://raw.githubusercontent.com/BrennerSpear/clarity/main/docs/images/temporal.png)

### Mastodon

![Mastodon architecture](https://raw.githubusercontent.com/BrennerSpear/clarity/main/docs/images/mastodon.png)

## Features

- **Auto-detection**: Finds docker-compose.yml, compose.yml, and Helm charts
- **Smart layout**: Semantic grouping with ELK.js layout engine
- **LLM enhancement**: Optional AI-powered service descriptions (via OpenRouter)
- **Excalidraw output**: Hand-drawn style diagrams you can edit
- **PNG export**: High-quality rendered images

## Installation

```bash
npm install -g @clarity-tools/cli
```

**Requirements:**
- Node.js 18+
- Chromium (auto-downloaded by Puppeteer on first run)

## Quick Start

```bash
# Run in a directory with docker-compose.yml or Helm chart
cd my-project
iac-diagrams

# Or specify a file/directory
iac-diagrams ./docker-compose.yml
iac-diagrams ./charts/my-app/

# Output goes to ./docs/diagrams/ by default
open docs/diagrams/docker-compose.png
```

## Usage

```bash
iac-diagrams [path] [options]
```

**Arguments:**
- `path` - File or directory to process (default: current directory)

**Options:**
- `-o, --output <dir>` - Output directory (default: `./docs/diagrams`)
- `--no-llm` - Disable LLM enhancement
- `--no-png` - Skip PNG rendering (output .excalidraw only)
- `-v, --verbose` - Show detailed output

**Examples:**
```bash
# Process current directory
iac-diagrams

# Process specific file
iac-diagrams docker-compose.yml

# Process Helm chart directory
iac-diagrams ./charts/my-app/

# Custom output directory
iac-diagrams -o ./architecture/

# Skip LLM and PNG (fast mode)
iac-diagrams --no-llm --no-png

# Verbose output
iac-diagrams -v
```

## Configuration

### LLM Enhancement

The tool can use OpenRouter's LLM API to:
- Generate service descriptions
- Suggest logical groupings
- Add category metadata

To enable, set your OpenRouter API key:

```bash
# Set via CLI
iac-diagrams config set-key sk-or-...

# Or via environment variable
export OPENROUTER_API_KEY=sk-or-...

# View current config
iac-diagrams config show

# Clear API key
iac-diagrams config clear-key
```

## Output

Files are saved to the output directory (default `./docs/diagrams/`):

```
docs/diagrams/
├── docker-compose.excalidraw  # Excalidraw JSON (open at excalidraw.com)
└── docker-compose.png         # Rendered PNG image
```

The `.excalidraw` file can be opened at [excalidraw.com](https://excalidraw.com) for editing.

## Supported Formats

| Format | Status | Notes |
|--------|--------|-------|
| Docker Compose | ✅ | docker-compose.yml, compose.yml |
| Helm Charts | ✅ | Detects Chart.yaml in directories |
| Kubernetes YAML | 🔜 | Coming soon |
| Terraform | 🔜 | Coming soon |

## Troubleshooting

### Browser not available

If you see "Browser not available for PNG rendering", Puppeteer couldn't launch Chromium.

**Fix:**
```bash
# Install Chrome for Puppeteer
npx puppeteer browsers install chrome

# Or use your system Chrome
export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Or skip PNG generation
iac-diagrams --no-png
```

### No IaC files found

The tool looks for:
- `docker-compose.yml`, `docker-compose.yaml`
- `compose.yml`, `compose.yaml`
- Directories containing `Chart.yaml` (Helm charts)

### API key not working

Ensure your OpenRouter API key is valid:
```bash
iac-diagrams config show
```

The key should start with `sk-or-`.

## License

MIT
