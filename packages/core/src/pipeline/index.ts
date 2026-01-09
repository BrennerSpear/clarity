import type Anthropic from "@anthropic-ai/sdk"
import { renderGroupedToExcalidraw, renderToExcalidraw } from "../excalidraw/render"
import type { ExcalidrawFile } from "../excalidraw/types"
import type { InfraGraph } from "../graph/types"
import { createClient, parseJsonResponse, sendMessage } from "../llm/client"
import {
	type EnhancementResponse,
	applyEnhancements,
	buildEnhancePrompt,
} from "../llm/prompts"
import { graphToMermaid, graphToMermaidStyled } from "../output/mermaid"
import { renderExcalidrawToPng } from "../output/png"
import { parseDockerCompose } from "../parsers/docker-compose"
import {
	ensureRunDir,
	generateRunId,
	getPngPath,
	listSourceFiles,
	readSourceFile,
	saveEnhancedGraph,
	saveExcalidrawFile,
	saveMermaidFile,
	saveParsedGraph,
	savePngFile,
	saveRunMeta,
	saveValidationResult,
	saveValidationSummary,
} from "./storage"
import type { PipelineConfig, PipelineRun, ResolutionLevel, StepResult } from "./types"
import {
	type ValidationSummary,
	type VisualValidationResult,
	calculateAverageScore,
	createValidationSummary,
	isValidationPassing,
	validateDiagram,
} from "./validate"

export * from "./types"
export * from "./storage"
export * from "./validate"

/**
 * Run the parse step: parse all source files into an InfraGraph
 */
export async function runParseStep(
	project: string,
	runId: string,
	options?: { saveMermaid?: boolean },
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

		const outputFiles: string[] = []

		// Save parsed graph
		const outputFile = await saveParsedGraph(project, runId, graph)
		outputFiles.push(outputFile)

		// Optionally save Mermaid debug output
		if (options?.saveMermaid !== false) {
			const mermaid = graphToMermaid(graph)
			const mermaidFile = await saveMermaidFile(project, runId, mermaid, "01-parsed")
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
	client?: Anthropic,
	model?: string,
	options?: { saveMermaid?: boolean },
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

		const outputFiles: string[] = []

		// Save enhanced graph
		const outputFile = await saveEnhancedGraph(project, runId, enhancedGraph)
		outputFiles.push(outputFile)

		// Optionally save styled Mermaid output
		if (options?.saveMermaid !== false) {
			const mermaid = graphToMermaidStyled(enhancedGraph)
			const mermaidFile = await saveMermaidFile(project, runId, mermaid, "02-enhanced")
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
	options?: { renderPng?: boolean; grouped?: boolean },
): Promise<{ excalidraw: ExcalidrawFile; pngBuffer?: Buffer; result: GenerateStepResult }> {
	const startedAt = new Date().toISOString()
	const startTime = Date.now()
	const shouldRenderPng = options?.renderPng !== false
	const useGrouped = options?.grouped !== false // Default to grouped

	try {
		// Generate Excalidraw JSON (grouped by default for cleaner diagrams)
		const excalidraw = useGrouped
			? renderGroupedToExcalidraw(graph, { minGroupSize: 2, showEdgeDirection: true })
			: renderToExcalidraw(graph)

		const outputFiles: string[] = []

		// Save the Excalidraw JSON file
		const outputFile = await saveExcalidrawFile(project, runId, excalidraw)
		outputFiles.push(outputFile)

		// Render to PNG if enabled
		let pngBuffer: Buffer | undefined
		if (shouldRenderPng) {
			try {
				pngBuffer = await renderExcalidrawToPng(excalidraw)
				const pngFile = await savePngFile(project, runId, pngBuffer)
				outputFiles.push(pngFile)
			} catch (pngError) {
				// Log but don't fail - PNG is optional
				console.warn(
					"PNG rendering failed:",
					pngError instanceof Error ? pngError.message : String(pngError),
				)
			}
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
 * Validate step result with validation details
 */
export interface ValidateStepResult extends StepResult {
	llmModel?: string
	tokensUsed?: number
	validationPassed?: boolean
	averageScore?: number
}

/**
 * Run the validate step: use Claude Vision to validate the generated diagram
 */
export async function runValidateStep(
	project: string,
	runId: string,
	graph: InfraGraph,
	pngBuffer: Buffer,
	client?: Anthropic,
	model?: string,
): Promise<{ validationResult: VisualValidationResult; result: ValidateStepResult }> {
	const startedAt = new Date().toISOString()
	const startTime = Date.now()

	try {
		const llmClient = client ?? createClient()
		const llmModel = model ?? "claude-sonnet-4-20250514"

		// Validate the diagram
		const validationResult = await validateDiagram(pngBuffer, graph, llmClient, llmModel)

		const outputFiles: string[] = []

		// Save validation result
		const outputFile = await saveValidationResult(project, runId, validationResult, "services")
		outputFiles.push(outputFile)

		// Create and save summary
		const summary = createValidationSummary({ services: validationResult })
		const summaryFile = await saveValidationSummary(project, runId, summary)
		outputFiles.push(summaryFile)

		const duration = Date.now() - startTime
		const passed = isValidationPassing(validationResult)
		const avgScore = calculateAverageScore(validationResult)

		return {
			validationResult,
			result: {
				step: "validate",
				status: "completed",
				startedAt,
				completedAt: new Date().toISOString(),
				duration,
				outputFile,
				outputFiles,
				llmModel,
				validationPassed: passed,
				averageScore: avgScore,
			},
		}
	} catch (error) {
		const duration = Date.now() - startTime
		return {
			validationResult: {
				valid: false,
				issues: [error instanceof Error ? error.message : String(error)],
				suggestions: [],
				scores: { completeness: 0, clarity: 0, connections: 0, grouping: 0 },
			},
			result: {
				step: "validate",
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
 * Pipeline run config with validation options
 */
export interface ExtendedPipelineConfig extends PipelineConfig {
	validation?: {
		enabled: boolean
		model?: string
	}
	mermaid?: {
		enabled: boolean
	}
	png?: {
		enabled: boolean
	}
	/** Group services by dependency path (default: true) */
	grouped?: boolean
}

/**
 * Run the full pipeline for a project
 */
export async function runPipeline(
	config: ExtendedPipelineConfig,
): Promise<PipelineRun> {
	const runId = generateRunId()
	await ensureRunDir(config.project, runId)

	const saveMermaid = config.mermaid?.enabled !== false
	const renderPng = config.png?.enabled !== false
	const validateEnabled = config.validation?.enabled ?? false
	const useGrouped = config.grouped !== false // Default to grouped

	const run: PipelineRun = {
		id: runId,
		project: config.project,
		startedAt: new Date().toISOString(),
		status: "running",
		steps: [],
		config: {
			llmEnabled: config.llm?.enabled ?? false,
			validationEnabled: validateEnabled,
			resolutionLevels: config.excalidraw?.resolutionLevels,
		},
	}

	// Save initial state
	await saveRunMeta(config.project, runId, run)

	// Run parse step
	const { graph: parsedGraph, result: parseResult } = await runParseStep(
		config.project,
		runId,
		{ saveMermaid },
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
				{ saveMermaid },
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
	const { pngBuffer, result: generateResult } = await runGenerateStep(
		config.project,
		runId,
		currentGraph,
		{ renderPng, grouped: useGrouped },
	)
	run.steps.push(generateResult)
	await saveRunMeta(config.project, runId, run)

	if (generateResult.status === "failed") {
		run.status = "failed"
		run.completedAt = new Date().toISOString()
		await saveRunMeta(config.project, runId, run)
		return run
	}

	// Run validate step if enabled and PNG was generated
	if (validateEnabled && pngBuffer) {
		const { result: validateResult } = await runValidateStep(
			config.project,
			runId,
			currentGraph,
			pngBuffer,
			undefined,
			config.validation?.model,
		)
		run.steps.push(validateResult)
	}

	// Update status based on step results
	const hasFailedStep = run.steps.some((s) => s.status === "failed")
	run.status = hasFailedStep ? "failed" : "completed"
	run.completedAt = new Date().toISOString()

	// Save final state
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
		case "validate": {
			// Need to run full pipeline up to generate, then validate
			const { graph: parsedGraph, result: parseResult } = await runParseStep(
				config.project,
				runId,
			)
			if (parseResult.status === "failed") {
				return {
					step: "validate",
					status: "failed",
					error: `Parse step failed: ${parseResult.error}`,
				}
			}

			let graphToRender = parsedGraph

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

			const { pngBuffer, result: generateResult } = await runGenerateStep(
				config.project,
				runId,
				graphToRender,
				{ renderPng: true },
			)

			if (generateResult.status === "failed" || !pngBuffer) {
				return {
					step: "validate",
					status: "failed",
					error: "Generate step failed or PNG not available",
				}
			}

			const { result } = await runValidateStep(
				config.project,
				runId,
				graphToRender,
				pngBuffer,
				undefined,
				config.validation?.model,
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
