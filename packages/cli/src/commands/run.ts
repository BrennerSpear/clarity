import { Command } from "commander"
import {
	runPipeline,
	runParseStep,
	generateRunId,
	ensureRunDir,
	loadParsedGraph,
	getRunDir,
} from "@ite/core"
import { formatRunSummary, formatGraphSummary } from "../utils/output"

export const runCommand = new Command("run")
	.description("Run the pipeline for a project")
	.argument("<project>", "Project ID to process")
	.option("-s, --step <step>", "Run only a specific step (parse, enhance, generate, validate)")
	.option("--no-llm", "Disable LLM enhancement")
	.option("-v, --verbose", "Show detailed output")
	.action(
		async (
			projectId: string,
			options: { step?: string; llm?: boolean; verbose?: boolean },
		) => {
			console.log(`Running pipeline for project: ${projectId}\n`)

			if (options.step) {
				// Run single step
				const runId = generateRunId()
				await ensureRunDir(projectId, runId)

				console.log(`Running step: ${options.step}`)
				console.log(`Run ID: ${runId}\n`)

				switch (options.step) {
					case "parse": {
						const { graph, result } = await runParseStep(projectId, runId)

						if (result.status === "completed") {
							console.log("\x1b[32m✓\x1b[0m Parse completed successfully\n")

							if (options.verbose) {
								console.log(formatGraphSummary(graph))
							} else {
								console.log(`Nodes: ${graph.nodes.length}`)
								console.log(`Edges: ${graph.edges.length}`)
							}

							console.log(`\nOutput: ${getRunDir(projectId, runId)}/${result.outputFile}`)
						} else {
							console.error(`\x1b[31m✗\x1b[0m Parse failed: ${result.error}`)
							process.exit(1)
						}
						break
					}
					default:
						console.error(`Step "${options.step}" not implemented yet`)
						process.exit(1)
				}
			} else {
				// Run full pipeline
				const run = await runPipeline({
					project: projectId,
					outputDir: `test-data/${projectId}/runs`,
					llm: { enabled: options.llm ?? true },
				})

				console.log(formatRunSummary(run))

				if (run.status === "completed" && options.verbose) {
					const graph = await loadParsedGraph(projectId, run.id)
					if (graph) {
						console.log("\n" + formatGraphSummary(graph))
					}
				}

				if (run.status === "failed") {
					process.exit(1)
				}
			}
		},
	)
