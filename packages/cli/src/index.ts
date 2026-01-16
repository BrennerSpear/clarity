import { Command } from "commander"
import { configCommand } from "./commands/config"
import { generate } from "./generate"

const program = new Command()
	.name("iac-diagrams")
	.description(
		"Generate architecture diagrams from Infrastructure-as-Code files",
	)
	.version("0.1.0")
	.argument(
		"[path]",
		"File or directory to process (default: current directory)",
		".",
	)
	.option("-o, --output <dir>", "Output directory", "./docs/diagrams")
	.option("--no-llm", "Disable LLM enhancement")
	.option("--no-png", "Skip PNG rendering (output .excalidraw only)")
	.option(
		"--artifacts",
		"Save parsed/enhanced/elk JSON artifacts alongside outputs",
	)
	.option(
		"--values <files...>",
		"Additional Helm values files to merge (for Helm charts)",
	)
	.option("-v, --verbose", "Show detailed output")
	.action(
		async (
			path: string,
			options: {
				output?: string
				llm?: boolean
				png?: boolean
				artifacts?: boolean
				values?: string[]
				verbose?: boolean
			},
		) => {
			await generate(path, options)
		},
	)

program.addCommand(configCommand)

program.parse()
