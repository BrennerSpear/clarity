import { join } from "node:path"
import { infraGraphToElk, summarizeLayers } from "../elk/convert"
import { runLayout } from "../elk/layout"
import type { ElkGraph } from "../elk/types"
import { renderWithElkLayout } from "../excalidraw/elk-render"
import type { ExcalidrawFile } from "../excalidraw/types"
import type { InfraGraph } from "../graph/types"
import { DEFAULT_MODEL, parseJsonResponse, sendMessage } from "../llm/client"
import {
	type EnhancementResponse,
	applyEnhancements,
	buildEnhancePrompt,
} from "../llm/prompts"
import { graphToMermaid, graphToMermaidStyled } from "../output/mermaid"
import { renderExcalidrawToPng } from "../output/png"
import { parseDockerCompose } from "../parsers/docker-compose"
import { parseHelmChart } from "../parsers/helm"
import { parseTerraformFiles } from "../parsers/terraform"
import {
	ensureRunDir,
	generateRunId,
	getSourceDir,
	listSourceFiles,
	readSourceFile,
	saveElkInput,
	saveElkOutput,
	saveEnhancedGraph,
	saveExcalidrawFile,
	saveMermaidFile,
	saveParsedGraph,
	savePngFile,
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
	options?: { saveMermaid?: boolean; helmValuesFiles?: string[] },
): Promise<{ graph: InfraGraph; result: StepResult }> {
	const startedAt = new Date().toISOString()
	const startTime = Date.now()

	try {
		const sourceFiles = await listSourceFiles(project)

		if (sourceFiles.length === 0) {
			throw new Error(`No source files found for project: ${project}`)
		}

		// Detect docker-compose files
		const composeFiles = sourceFiles.filter(
			(f) => f.includes("docker-compose") || f.includes("compose"),
		)

		// Detect Helm charts (Chart.yaml)
		const helmCharts = sourceFiles.filter((f) => /(^|\/)Chart\.ya?ml$/i.test(f))
		const terraformFiles = sourceFiles.filter((f) => {
			const lower = f.toLowerCase()
			if (lower.endsWith(".tf")) {
				return !lower.includes(".tfvars")
			}
			if (lower.endsWith(".tf.json")) {
				return !lower.includes(".tfvars")
			}
			return false
		})

		let graph: InfraGraph

		if (composeFiles.length > 0) {
			// Parse the first compose file (TODO: merge multiple files)
			const filename = composeFiles[0]
			if (!filename) {
				throw new Error("No compose file to parse")
			}

			const content = await readSourceFile(project, filename)
			graph = parseDockerCompose(content, filename, project)
		} else if (helmCharts.length > 0) {
			const chartFile = helmCharts[0]
			if (!chartFile) {
				throw new Error("No Helm chart found")
			}

			const chartDir = chartFile.includes("/")
				? chartFile.slice(0, chartFile.lastIndexOf("/"))
				: "."
			const sourceRoot = getSourceDir(project)
			const chartPath = join(sourceRoot, chartDir)
			const resolvedValuesFiles =
				options?.helmValuesFiles?.map((file) =>
					file.startsWith("/") ? file : join(sourceRoot, file),
				) ?? []
			graph = parseHelmChart(chartPath, project, sourceRoot, {
				valuesFiles: resolvedValuesFiles,
			})
		} else if (terraformFiles.length > 0) {
			const parsedFiles = await Promise.all(
				terraformFiles.map(async (filename) => ({
					path: filename,
					content: await readSourceFile(project, filename),
				})),
			)
			graph = parseTerraformFiles(parsedFiles, project)
		} else {
			// Try any yaml file as docker-compose
			const yamlFiles = sourceFiles.filter(
				(f) =>
					(f.endsWith(".yml") || f.endsWith(".yaml")) &&
					!/(^|\/)Chart\.ya?ml$/i.test(f) &&
					!/(^|\/)values\.ya?ml$/i.test(f) &&
					!f.includes("/templates/"),
			)
			if (yamlFiles.length === 0) {
				throw new Error("No docker-compose files found")
			}

			const filename = yamlFiles[0]
			if (!filename) {
				throw new Error("No compose file to parse")
			}

			const content = await readSourceFile(project, filename)
			graph = parseDockerCompose(content, filename, project)
		}

		const outputFiles: string[] = []

		// Save parsed graph
		const outputFile = await saveParsedGraph(project, runId, graph)
		outputFiles.push(outputFile)

		// Optionally save Mermaid debug output
		if (options?.saveMermaid !== false) {
			const mermaid = graphToMermaid(graph)
			const mermaidFile = await saveMermaidFile(
				project,
				runId,
				mermaid,
				"01-parsed",
			)
			outputFiles.push(mermaidFile)
		}

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
				outputFiles,
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
	apiKey: string,
	model?: string,
	options?: { saveMermaid?: boolean },
): Promise<{ graph: InfraGraph; result: EnhanceStepResult }> {
	const startedAt = new Date().toISOString()
	const startTime = Date.now()

	try {
		const llmModel = model ?? DEFAULT_MODEL

		// Build prompt and send to LLM
		const prompt = buildEnhancePrompt(graph)
		const response = await sendMessage(apiKey, prompt, { model: llmModel })

		// Parse response and apply enhancements
		const enhancements = parseJsonResponse<EnhancementResponse>(response)
		const enhancedGraph = applyEnhancements(graph, enhancements)

		const outputFiles: string[] = []

		// Save enhanced graph
		const outputFile = await saveEnhancedGraph(project, runId, enhancedGraph)
		outputFiles.push(outputFile)

		// Optionally save styled Mermaid output
		if (options?.saveMermaid !== false) {
			const mermaid = graphToMermaidStyled(enhancedGraph)
			const mermaidFile = await saveMermaidFile(
				project,
				runId,
				mermaid,
				"02-enhanced",
			)
			outputFiles.push(mermaidFile)
		}

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
				outputFiles,
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
 * Layout step result with ELK output
 */
export interface LayoutStepResult extends StepResult {
	/** Summary of layer assignments */
	layers?: Record<string, string[]>
}

/**
 * Run the layout step: convert InfraGraph to ELK graph and compute positions
 */
export async function runLayoutStep(
	project: string,
	runId: string,
	graph: InfraGraph,
): Promise<{
	elkGraph: ElkGraph
	result: LayoutStepResult
}> {
	const startedAt = new Date().toISOString()
	const startTime = Date.now()

	try {
		// Convert InfraGraph to ELK format with semantic layers
		const { graph: elkInput, layerAssignments } = infraGraphToElk(graph)
		const layers = summarizeLayers(layerAssignments)

		const outputFiles: string[] = []

		// Save the ELK input (for debugging in ELK viewer)
		const inputFile = await saveElkInput(project, runId, elkInput)
		outputFiles.push(inputFile)

		// Run ELK layout to compute positions
		const { graph: elkOutput, width, height } = await runLayout(elkInput)

		// Save the ELK output (with positions)
		const outputFile = await saveElkOutput(project, runId, elkOutput)
		outputFiles.push(outputFile)

		const duration = Date.now() - startTime

		console.log(`Layout computed: ${width}x${height}`)
		console.log("Layer assignments:", layers)

		return {
			elkGraph: elkOutput,
			result: {
				step: "layout",
				status: "completed",
				startedAt,
				completedAt: new Date().toISOString(),
				duration,
				outputFile,
				outputFiles,
				layers,
			},
		}
	} catch (error) {
		const duration = Date.now() - startTime
		return {
			elkGraph: { id: "root", children: [], edges: [] },
			result: {
				step: "layout",
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
 * Generate step result with PNG rendering info
 */
export interface GenerateStepResult extends StepResult {
	pngGenerated?: boolean
}

/**
 * Run the generate step: convert InfraGraph to Excalidraw JSON and PNG
 */
export async function runGenerateStep(
	project: string,
	runId: string,
	graph: InfraGraph,
	options: {
		renderPng?: boolean
		elkGraph: ElkGraph
	},
): Promise<{
	excalidraw: ExcalidrawFile
	pngBuffer?: Buffer
	result: GenerateStepResult
}> {
	const startedAt = new Date().toISOString()
	const startTime = Date.now()
	const shouldRenderPng = options.renderPng !== false

	try {
		// Generate Excalidraw JSON using ELK layout
		const excalidraw = renderWithElkLayout(graph, options.elkGraph)

		const outputFiles: string[] = []

		// Save the Excalidraw JSON file
		const outputFile = await saveExcalidrawFile(project, runId, excalidraw)
		outputFiles.push(outputFile)

		// Render to PNG if enabled
		let pngBuffer: Buffer | undefined
		if (shouldRenderPng) {
			pngBuffer = await renderExcalidrawToPng(excalidraw)
			const pngFile = await savePngFile(project, runId, pngBuffer)
			outputFiles.push(pngFile)
		}

		const duration = Date.now() - startTime

		return {
			excalidraw,
			pngBuffer,
			result: {
				step: "generate",
				status: "completed",
				startedAt,
				completedAt: new Date().toISOString(),
				duration,
				outputFile,
				outputFiles,
				pngGenerated: !!pngBuffer,
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
 * Pipeline run config
 */
export interface ExtendedPipelineConfig extends PipelineConfig {
	mermaid?: {
		enabled: boolean
	}
	png?: {
		enabled: boolean
	}
	runId?: string
	helmValuesFiles?: string[]
}

/**
 * Run the full pipeline for a project
 */
export async function runPipeline(
	config: ExtendedPipelineConfig,
): Promise<PipelineRun> {
	const runId = config.runId ?? generateRunId()
	await ensureRunDir(config.project, runId)

	const saveMermaid = config.mermaid?.enabled === true
	const renderPng = config.png?.enabled !== false

	const run: PipelineRun = {
		id: runId,
		project: config.project,
		startedAt: new Date().toISOString(),
		status: "running",
		steps: [],
		config: {
			llmEnabled: config.llm?.enabled ?? false,
		},
	}

	// Save initial state
	await saveRunMeta(config.project, runId, run)

	// Step 1: Parse
	const { graph: parsedGraph, result: parseResult } = await runParseStep(
		config.project,
		runId,
		{ saveMermaid, helmValuesFiles: config.helmValuesFiles },
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

	// Step 2: Enhance (if LLM is enabled and API key is provided)
	if (config.llm?.enabled && config.llm.apiKey) {
		const { graph: enhancedGraph, result: enhanceResult } =
			await runEnhanceStep(
				config.project,
				runId,
				currentGraph,
				config.llm.apiKey,
				config.llm.model,
				{ saveMermaid },
			)
		run.steps.push(enhanceResult)
		await saveRunMeta(config.project, runId, run)

		if (enhanceResult.status === "failed") {
			run.status = "failed"
			run.completedAt = new Date().toISOString()
			await saveRunMeta(config.project, runId, run)
			return run
		}
		currentGraph = enhancedGraph
	}

	// Step 3: Layout
	const { elkGraph, result: layoutResult } = await runLayoutStep(
		config.project,
		runId,
		currentGraph,
	)
	run.steps.push(layoutResult)
	await saveRunMeta(config.project, runId, run)

	if (layoutResult.status === "failed") {
		run.status = "failed"
		run.completedAt = new Date().toISOString()
		await saveRunMeta(config.project, runId, run)
		return run
	}

	// Step 4: Generate
	const { result: generateResult } = await runGenerateStep(
		config.project,
		runId,
		currentGraph,
		{ renderPng, elkGraph },
	)
	run.steps.push(generateResult)
	await saveRunMeta(config.project, runId, run)

	if (generateResult.status === "failed") {
		run.status = "failed"
		run.completedAt = new Date().toISOString()
		await saveRunMeta(config.project, runId, run)
		return run
	}

	// Pipeline completed successfully
	run.status = "completed"
	run.completedAt = new Date().toISOString()
	await saveRunMeta(config.project, runId, run)

	return run
}

/**
 * Run a single pipeline step
 */
export async function runStep(
	config: ExtendedPipelineConfig,
	step: PipelineConfig["steps"] extends (infer T)[] ? T : never,
): Promise<StepResult> {
	const runId = config.runId ?? generateRunId()
	await ensureRunDir(config.project, runId)

	switch (step) {
		case "parse": {
			const { result } = await runParseStep(config.project, runId, {
				helmValuesFiles: config.helmValuesFiles,
			})
			return result
		}
		case "enhance": {
			// First need to parse
			const { graph, result: parseResult } = await runParseStep(
				config.project,
				runId,
				{ helmValuesFiles: config.helmValuesFiles },
			)
			if (parseResult.status === "failed") {
				throw new Error(`Parse step failed: ${parseResult.error}`)
			}
			if (!config.llm?.apiKey) {
				throw new Error("API key required for enhance step")
			}
			const { result } = await runEnhanceStep(
				config.project,
				runId,
				graph,
				config.llm.apiKey,
				config.llm?.model,
			)
			if (result.status === "failed") {
				throw new Error(`Enhance step failed: ${result.error}`)
			}
			return result
		}
		case "layout": {
			// First need to parse
			const { graph: parsedGraph, result: parseResult } = await runParseStep(
				config.project,
				runId,
				{ helmValuesFiles: config.helmValuesFiles },
			)
			if (parseResult.status === "failed") {
				throw new Error(`Parse step failed: ${parseResult.error}`)
			}

			let graphToLayout = parsedGraph

			// If LLM is enabled and API key provided, enhance first
			if (config.llm?.enabled && config.llm.apiKey) {
				const { graph: enhancedGraph, result: enhanceResult } =
					await runEnhanceStep(
						config.project,
						runId,
						parsedGraph,
						config.llm.apiKey,
						config.llm.model,
					)
				if (enhanceResult.status === "failed") {
					throw new Error(`Enhance step failed: ${enhanceResult.error}`)
				}
				graphToLayout = enhancedGraph
			}

			const { result } = await runLayoutStep(
				config.project,
				runId,
				graphToLayout,
			)
			if (result.status === "failed") {
				throw new Error(`Layout step failed: ${result.error}`)
			}
			return result
		}
		case "generate": {
			// Need to run parse, optionally enhance, then layout
			const { graph: parsedGraph, result: parseResult } = await runParseStep(
				config.project,
				runId,
				{ helmValuesFiles: config.helmValuesFiles },
			)
			if (parseResult.status === "failed") {
				throw new Error(`Parse step failed: ${parseResult.error}`)
			}

			let graphToRender = parsedGraph

			// If LLM is enabled and API key provided, enhance first
			if (config.llm?.enabled && config.llm.apiKey) {
				const { graph: enhancedGraph, result: enhanceResult } =
					await runEnhanceStep(
						config.project,
						runId,
						parsedGraph,
						config.llm.apiKey,
						config.llm.model,
					)
				if (enhanceResult.status === "failed") {
					throw new Error(`Enhance step failed: ${enhanceResult.error}`)
				}
				graphToRender = enhancedGraph
			}

			// Run layout
			const { elkGraph, result: layoutResult } = await runLayoutStep(
				config.project,
				runId,
				graphToRender,
			)
			if (layoutResult.status === "failed") {
				throw new Error(`Layout step failed: ${layoutResult.error}`)
			}

			const { result } = await runGenerateStep(
				config.project,
				runId,
				graphToRender,
				{
					elkGraph,
				},
			)
			if (result.status === "failed") {
				throw new Error(`Generate step failed: ${result.error}`)
			}
			return result
		}
		default:
			throw new Error(`Unknown step: ${step}`)
	}
}
