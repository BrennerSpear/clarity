import {
	ensureRunDir,
	generateRunId,
	getRunDir,
	loadParsedGraph,
	runEnhanceStep,
	runGenerateStep,
	runLayoutStep,
	runParseStep,
	runPipeline,
} from "@clarity/core"
import { Command } from "commander"
import {
	formatExcalidrawSummary,
	formatGraphSummary,
	formatRunSummary,
} from "../utils/output"

export const runCommand = new Command("run")
	.description("Run the pipeline for a project")
	.argument("<project>", "Project ID to process")
	.option(
		"-s, --step <step>",
		"Run only a specific step (parse, enhance, layout, generate)",
	)
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

						if (result.status === "failed") {
							console.error(`\x1b[31m✗\x1b[0m Parse failed: ${result.error}`)
							process.exit(1)
						}

						console.log("\x1b[32m✓\x1b[0m Parse completed successfully\n")

						if (options.verbose) {
							console.log(formatGraphSummary(graph))
						} else {
							console.log(`Nodes: ${graph.nodes.length}`)
							console.log(`Edges: ${graph.edges.length}`)
						}

						console.log(
							`\nOutput: ${getRunDir(projectId, runId)}/${result.outputFile}`,
						)
						break
					}
					case "enhance": {
						// First parse
						const { graph: parsedGraph, result: parseResult } =
							await runParseStep(projectId, runId)
						if (parseResult.status === "failed") {
							console.error(
								`\x1b[31m✗\x1b[0m Parse failed: ${parseResult.error}`,
							)
							process.exit(1)
						}
						console.log("\x1b[32m✓\x1b[0m Parse completed")

						// Then enhance
						const { graph, result } = await runEnhanceStep(
							projectId,
							runId,
							parsedGraph,
						)

						if (result.status === "failed") {
							console.error(`\x1b[31m✗\x1b[0m Enhance failed: ${result.error}`)
							process.exit(1)
						}

						console.log("\x1b[32m✓\x1b[0m Enhance completed successfully\n")

						if (options.verbose) {
							console.log(formatGraphSummary(graph))
						} else {
							console.log(`Nodes: ${graph.nodes.length}`)
							console.log(`Edges: ${graph.edges.length}`)
						}

						console.log(
							`\nOutput: ${getRunDir(projectId, runId)}/${result.outputFile}`,
						)
						break
					}
					case "layout": {
						// First parse
						const { graph: parsedGraph, result: parseResult } =
							await runParseStep(projectId, runId)
						if (parseResult.status === "failed") {
							console.error(
								`\x1b[31m✗\x1b[0m Parse failed: ${parseResult.error}`,
							)
							process.exit(1)
						}
						console.log("\x1b[32m✓\x1b[0m Parse completed")

						// Optionally enhance
						let graphToLayout = parsedGraph
						if (options.llm !== false) {
							const { graph: enhancedGraph, result: enhanceResult } =
								await runEnhanceStep(projectId, runId, parsedGraph)
							if (enhanceResult.status === "failed") {
								console.error(
									`\x1b[31m✗\x1b[0m Enhance failed: ${enhanceResult.error}`,
								)
								process.exit(1)
							}
							console.log("\x1b[32m✓\x1b[0m Enhance completed")
							graphToLayout = enhancedGraph
						}

						// Then layout
						const { result } = await runLayoutStep(
							projectId,
							runId,
							graphToLayout,
						)

						if (result.status === "failed") {
							console.error(`\x1b[31m✗\x1b[0m Layout failed: ${result.error}`)
							process.exit(1)
						}

						console.log("\x1b[32m✓\x1b[0m Layout completed successfully\n")
						console.log(
							`\nOutput: ${getRunDir(projectId, runId)}/${result.outputFile}`,
						)
						break
					}
					case "generate": {
						// First parse
						const { graph: parsedGraph, result: parseResult } =
							await runParseStep(projectId, runId)
						if (parseResult.status === "failed") {
							console.error(
								`\x1b[31m✗\x1b[0m Parse failed: ${parseResult.error}`,
							)
							process.exit(1)
						}
						console.log("\x1b[32m✓\x1b[0m Parse completed")

						// Optionally enhance
						let graphToRender = parsedGraph
						if (options.llm !== false) {
							const { graph: enhancedGraph, result: enhanceResult } =
								await runEnhanceStep(projectId, runId, parsedGraph)
							if (enhanceResult.status === "failed") {
								console.error(
									`\x1b[31m✗\x1b[0m Enhance failed: ${enhanceResult.error}`,
								)
								process.exit(1)
							}
							console.log("\x1b[32m✓\x1b[0m Enhance completed")
							graphToRender = enhancedGraph
						}

						// Then layout
						const { elkGraph, result: layoutResult } = await runLayoutStep(
							projectId,
							runId,
							graphToRender,
						)
						if (layoutResult.status === "failed") {
							console.error(
								`\x1b[31m✗\x1b[0m Layout failed: ${layoutResult.error}`,
							)
							process.exit(1)
						}
						console.log("\x1b[32m✓\x1b[0m Layout completed")

						// Then generate
						const { excalidraw, result } = await runGenerateStep(
							projectId,
							runId,
							graphToRender,
							{ elkGraph },
						)

						if (result.status === "failed") {
							console.error(`\x1b[31m✗\x1b[0m Generate failed: ${result.error}`)
							process.exit(1)
						}

						console.log("\x1b[32m✓\x1b[0m Generate completed successfully\n")

						if (options.verbose) {
							console.log(formatExcalidrawSummary(excalidraw))
						} else {
							console.log(`Elements: ${excalidraw.elements.length}`)
						}

						console.log(
							`\nOutput: ${getRunDir(projectId, runId)}/${result.outputFile}`,
						)
						break
					}
					default:
						console.error(`Unknown step: "${options.step}"`)
						console.error("Available steps: parse, enhance, layout, generate")
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
						console.log(`\n${formatGraphSummary(graph)}`)
					}
				}

				if (run.status === "failed") {
					process.exit(1)
				}
			}
		},
	)
