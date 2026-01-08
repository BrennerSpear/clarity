import { readSourceFile, listSourceFiles, saveParsedGraph, saveRunMeta, generateRunId, ensureRunDir } from "./storage"
import { parseDockerCompose } from "../parsers/docker-compose"
import type { InfraGraph } from "../graph/types"
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
 * Run the full pipeline for a project
 */
export async function runPipeline(config: PipelineConfig): Promise<PipelineRun> {
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
		},
	}

	// Save initial state
	await saveRunMeta(config.project, runId, run)

	// Run parse step
	const { graph, result: parseResult } = await runParseStep(config.project, runId)
	run.steps.push(parseResult)
	run.sourceFiles = graph.metadata.sourceFiles

	// Update status based on step results
	if (parseResult.status === "failed") {
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
		default:
			return {
				step: step as StepResult["step"],
				status: "failed",
				error: `Step "${step}" not implemented yet`,
			}
	}
}
