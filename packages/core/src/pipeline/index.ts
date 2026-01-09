import type Anthropic from "@anthropic-ai/sdk"
import { renderToExcalidraw } from "../excalidraw/render"
import type { ExcalidrawFile } from "../excalidraw/types"
import type { InfraGraph } from "../graph/types"
import { createClient, parseJsonResponse, sendMessage } from "../llm/client"
import {
	type EnhancementResponse,
	applyEnhancements,
	buildEnhancePrompt,
} from "../llm/prompts"
import { parseDockerCompose } from "../parsers/docker-compose"
import {
	ensureRunDir,
	generateRunId,
	listSourceFiles,
	readSourceFile,
	saveEnhancedGraph,
	saveExcalidrawFile,
	saveParsedGraph,
	saveRunMeta,
} from "./storage"
import type { PipelineConfig, PipelineRun, StepResult } from "./types"

export * from "./types"
export * from "./storage"

/**
 * Run the parse step: parse all source files into an InfraGraph
 */
export async function runParseStep(
	project: string,
	runId: string,
): Promise<{ graph: InfraGraph; result: StepResult }> {
	const startedAt = new Date().toISOString()
	const startTime = Date.now()

	try {
		const sourceFiles = await listSourceFiles(project)

		if (sourceFiles.length === 0) {
			throw new Error(`No source files found for project: ${project}`)
		}

		// For now, only handle docker-compose files
		const composeFiles = sourceFiles.filter(
			(f) => f.includes("docker-compose") || f.includes("compose"),
		)

		if (composeFiles.length === 0) {
			// Try any yaml file as docker-compose
			const yamlFiles = sourceFiles.filter(
				(f) => f.endsWith(".yml") || f.endsWith(".yaml"),
			)
			if (yamlFiles.length === 0) {
				throw new Error("No docker-compose files found")
			}
			composeFiles.push(...yamlFiles)
		}

		// Parse the first compose file (TODO: merge multiple files)
		const filename = composeFiles[0]
		if (!filename) {
			throw new Error("No compose file to parse")
		}

		const content = await readSourceFile(project, filename)
		const graph = parseDockerCompose(content, filename, project)

		const outputFile = await saveParsedGraph(project, runId, graph)
		const duration = Date.now() - startTime

		return {
			graph,
			result: {
				step: "parse",
				status: "completed",
				startedAt,
				completedAt: new Date().toISOString(),
				duration,
				outputFile,
			},
		}
	} catch (error) {
		const duration = Date.now() - startTime
		return {
			graph: {
				nodes: [],
				edges: [],
				metadata: {
					project,
					parsedAt: new Date().toISOString(),
					sourceFiles: [],
					parserVersion: "0.1.0",
				},
			},
			result: {
				step: "parse",
				status: "failed",
				startedAt,
				completedAt: new Date().toISOString(),
				duration,
				error: error instanceof Error ? error.message : String(error),
			},
		}
	}
}

/**
 * Enhanced step result with LLM metadata
 */
export interface EnhanceStepResult extends StepResult {
	llmModel?: string
	tokensUsed?: number
}

/**
 * Run the enhance step: use LLM to categorize and group services
 */
export async function runEnhanceStep(
	project: string,
	runId: string,
	graph: InfraGraph,
	client?: Anthropic,
	model?: string,
): Promise<{ graph: InfraGraph; result: EnhanceStepResult }> {
	const startedAt = new Date().toISOString()
	const startTime = Date.now()

	try {
		// Create client if not provided
		const llmClient = client ?? createClient()
		const llmModel = model ?? "claude-sonnet-4-20250514"

		// Build prompt and send to LLM
		const prompt = buildEnhancePrompt(graph)
		const response = await sendMessage(llmClient, prompt, { model: llmModel })

		// Parse response and apply enhancements
		const enhancements = parseJsonResponse<EnhancementResponse>(response)
		const enhancedGraph = applyEnhancements(graph, enhancements)

		// Save enhanced graph
		const outputFile = await saveEnhancedGraph(project, runId, enhancedGraph)
		const duration = Date.now() - startTime

		return {
			graph: enhancedGraph,
			result: {
				step: "enhance",
				status: "completed",
				startedAt,
				completedAt: new Date().toISOString(),
				duration,
				outputFile,
				llmModel,
			},
		}
	} catch (error) {
		const duration = Date.now() - startTime
		return {
			graph, // Return original graph on failure
			result: {
				step: "enhance",
				status: "failed",
				startedAt,
				completedAt: new Date().toISOString(),
				duration,
				error: error instanceof Error ? error.message : String(error),
			},
		}
	}
}

/**
 * Run the generate step: convert InfraGraph to Excalidraw JSON
 */
export async function runGenerateStep(
	project: string,
	runId: string,
	graph: InfraGraph,
): Promise<{ excalidraw: ExcalidrawFile; result: StepResult }> {
	const startedAt = new Date().toISOString()
	const startTime = Date.now()

	try {
		// Generate Excalidraw JSON
		const excalidraw = renderToExcalidraw(graph)

		// Save the file
		const outputFile = await saveExcalidrawFile(project, runId, excalidraw)
		const duration = Date.now() - startTime

		return {
			excalidraw,
			result: {
				step: "generate",
				status: "completed",
				startedAt,
				completedAt: new Date().toISOString(),
				duration,
				outputFile,
			},
		}
	} catch (error) {
		const duration = Date.now() - startTime
		return {
			excalidraw: {
				type: "excalidraw",
				version: 2,
				source: "clarity",
				elements: [],
				appState: { viewBackgroundColor: "#ffffff", gridSize: null },
				files: {},
			},
			result: {
				step: "generate",
				status: "failed",
				startedAt,
				completedAt: new Date().toISOString(),
				duration,
				error: error instanceof Error ? error.message : String(error),
			},
		}
	}
}

/**
 * Run the full pipeline for a project
 */
export async function runPipeline(
	config: PipelineConfig,
): Promise<PipelineRun> {
	const runId = generateRunId()
	await ensureRunDir(config.project, runId)

	const run: PipelineRun = {
		id: runId,
		project: config.project,
		startedAt: new Date().toISOString(),
		status: "running",
		steps: [],
		config: {
			llmEnabled: config.llm?.enabled ?? false,
			validationEnabled: false,
			resolutionLevels: config.excalidraw?.resolutionLevels,
		},
	}

	// Save initial state
	await saveRunMeta(config.project, runId, run)

	// Run parse step
	const { graph: parsedGraph, result: parseResult } = await runParseStep(
		config.project,
		runId,
	)
	run.steps.push(parseResult)
	run.sourceFiles = parsedGraph.metadata.sourceFiles

	if (parseResult.status === "failed") {
		run.status = "failed"
		run.completedAt = new Date().toISOString()
		await saveRunMeta(config.project, runId, run)
		return run
	}

	// Track the current graph (may be enhanced or not)
	let currentGraph = parsedGraph

	// Run enhance step if LLM is enabled
	if (config.llm?.enabled) {
		const { graph: enhancedGraph, result: enhanceResult } =
			await runEnhanceStep(
				config.project,
				runId,
				currentGraph,
				undefined, // Use default client
				config.llm.model,
			)
		run.steps.push(enhanceResult)
		await saveRunMeta(config.project, runId, run)

		if (enhanceResult.status === "failed") {
			// Continue with unenhanced graph but log warning
			console.warn("Enhancement failed, continuing with parsed graph")
		} else {
			currentGraph = enhancedGraph
		}
	}

	// Run generate step
	const { result: generateResult } = await runGenerateStep(
		config.project,
		runId,
		currentGraph,
	)
	run.steps.push(generateResult)

	// Update status based on step results
	if (generateResult.status === "failed") {
		run.status = "failed"
	} else {
		run.status = "completed"
	}

	run.completedAt = new Date().toISOString()

	// Save final state
	await saveRunMeta(config.project, runId, run)

	return run
}

/**
 * Run a single pipeline step
 */
export async function runStep(
	config: PipelineConfig,
	step: PipelineConfig["steps"] extends (infer T)[] ? T : never,
): Promise<StepResult> {
	const runId = generateRunId()
	await ensureRunDir(config.project, runId)

	switch (step) {
		case "parse": {
			const { result } = await runParseStep(config.project, runId)
			return result
		}
		case "enhance": {
			// First need to parse
			const { graph, result: parseResult } = await runParseStep(
				config.project,
				runId,
			)
			if (parseResult.status === "failed") {
				return {
					step: "enhance",
					status: "failed",
					error: `Parse step failed: ${parseResult.error}`,
				}
			}
			const { result } = await runEnhanceStep(
				config.project,
				runId,
				graph,
				undefined,
				config.llm?.model,
			)
			return result
		}
		case "generate": {
			// First need to parse and optionally enhance
			const { graph: parsedGraph, result: parseResult } = await runParseStep(
				config.project,
				runId,
			)
			if (parseResult.status === "failed") {
				return {
					step: "generate",
					status: "failed",
					error: `Parse step failed: ${parseResult.error}`,
				}
			}

			let graphToRender = parsedGraph

			// If LLM is enabled, enhance first
			if (config.llm?.enabled) {
				const { graph: enhancedGraph, result: enhanceResult } =
					await runEnhanceStep(
						config.project,
						runId,
						parsedGraph,
						undefined,
						config.llm.model,
					)
				if (enhanceResult.status === "completed") {
					graphToRender = enhancedGraph
				}
			}

			const { result } = await runGenerateStep(
				config.project,
				runId,
				graphToRender,
			)
			return result
		}
		default:
			return {
				step: step as StepResult["step"],
				status: "failed",
				error: `Step "${step}" not implemented yet`,
			}
	}
}
