import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { ExcalidrawFile } from "../excalidraw/types"
import type { InfraGraph } from "../graph/types"
import type { PipelineRun, ResolutionLevel, StepResult } from "./types"
import type { ValidationSummary, VisualValidationResult } from "./validate"

/**
 * Generate a run ID from current timestamp
 */
export function generateRunId(): string {
	const now = new Date()
	const pad = (n: number) => n.toString().padStart(2, "0")

	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/**
 * Get the base directory for test data
 */
export function getTestDataDir(): string {
	return join(process.cwd(), "test-data")
}

/**
 * Get project directory within test-data
 */
export function getProjectDir(project: string): string {
	return join(getTestDataDir(), project)
}

/**
 * Get source directory for a project (where fetched files are stored)
 */
export function getSourceDir(project: string): string {
	return join(getProjectDir(project), "source")
}

/**
 * Get runs directory for a project
 */
export function getRunsDir(project: string): string {
	return join(getProjectDir(project), "runs")
}

/**
 * Get a specific run directory
 */
export function getRunDir(project: string, runId: string): string {
	return join(getRunsDir(project), runId)
}

/**
 * Ensure all necessary directories exist for a project
 */
export async function ensureProjectDirs(project: string): Promise<void> {
	await mkdir(getSourceDir(project), { recursive: true })
	await mkdir(getRunsDir(project), { recursive: true })
}

/**
 * Ensure run directory exists
 */
export async function ensureRunDir(
	project: string,
	runId: string,
): Promise<string> {
	const runDir = getRunDir(project, runId)
	await mkdir(runDir, { recursive: true })
	return runDir
}

/**
 * Save pipeline run metadata
 */
export async function saveRunMeta(
	project: string,
	runId: string,
	run: PipelineRun,
): Promise<void> {
	const runDir = await ensureRunDir(project, runId)
	const metaPath = join(runDir, "meta.json")
	await writeFile(metaPath, JSON.stringify(run, null, 2))
}

/**
 * Load pipeline run metadata
 */
export async function loadRunMeta(
	project: string,
	runId: string,
): Promise<PipelineRun | null> {
	const runDir = getRunDir(project, runId)
	const metaPath = join(runDir, "meta.json")
	try {
		const content = await readFile(metaPath, "utf-8")
		return JSON.parse(content) as PipelineRun
	} catch {
		return null
	}
}

/**
 * Save parsed graph to run directory
 */
export async function saveParsedGraph(
	project: string,
	runId: string,
	graph: InfraGraph,
): Promise<string> {
	const runDir = await ensureRunDir(project, runId)
	const filename = "01-parsed.json"
	const filepath = join(runDir, filename)
	await writeFile(filepath, JSON.stringify(graph, null, 2))
	return filename
}

/**
 * Load parsed graph from run directory
 */
export async function loadParsedGraph(
	project: string,
	runId: string,
): Promise<InfraGraph | null> {
	const runDir = getRunDir(project, runId)
	const filepath = join(runDir, "01-parsed.json")
	try {
		const content = await readFile(filepath, "utf-8")
		return JSON.parse(content) as InfraGraph
	} catch {
		return null
	}
}

/**
 * Save enhanced graph to run directory
 */
export async function saveEnhancedGraph(
	project: string,
	runId: string,
	graph: InfraGraph,
): Promise<string> {
	const runDir = await ensureRunDir(project, runId)
	const filename = "02-enhanced.json"
	const filepath = join(runDir, filename)
	await writeFile(filepath, JSON.stringify(graph, null, 2))
	return filename
}

/**
 * Load enhanced graph from run directory
 */
export async function loadEnhancedGraph(
	project: string,
	runId: string,
): Promise<InfraGraph | null> {
	const runDir = getRunDir(project, runId)
	const filepath = join(runDir, "02-enhanced.json")
	try {
		const content = await readFile(filepath, "utf-8")
		return JSON.parse(content) as InfraGraph
	} catch {
		return null
	}
}

/**
 * Save Excalidraw JSON to run directory
 */
export async function saveExcalidrawFile(
	project: string,
	runId: string,
	excalidraw: ExcalidrawFile,
	suffix?: string,
): Promise<string> {
	const runDir = await ensureRunDir(project, runId)
	const filename = suffix
		? `03-excalidraw-${suffix}.json`
		: "03-excalidraw.json"
	const filepath = join(runDir, filename)
	await writeFile(filepath, JSON.stringify(excalidraw, null, 2))
	return filename
}

/**
 * Load Excalidraw file from run directory
 */
export async function loadExcalidrawFile(
	project: string,
	runId: string,
	suffix?: string,
): Promise<ExcalidrawFile | null> {
	const runDir = getRunDir(project, runId)
	const filename = suffix
		? `03-excalidraw-${suffix}.json`
		: "03-excalidraw.json"
	const filepath = join(runDir, filename)
	try {
		const content = await readFile(filepath, "utf-8")
		return JSON.parse(content) as ExcalidrawFile
	} catch {
		return null
	}
}

/**
 * List all runs for a project, sorted by date descending
 */
export async function listRuns(project: string): Promise<PipelineRun[]> {
	const runsDir = getRunsDir(project)
	try {
		const entries = await readdir(runsDir, { withFileTypes: true })
		const runIds = entries
			.filter((e) => e.isDirectory())
			.map((e) => e.name)
			.sort()
			.reverse()

		const runs: PipelineRun[] = []
		for (const runId of runIds) {
			const run = await loadRunMeta(project, runId)
			if (run) {
				runs.push(run)
			}
		}
		return runs
	} catch {
		return []
	}
}

/**
 * Get the most recent run for a project
 */
export async function getLatestRun(
	project: string,
): Promise<PipelineRun | null> {
	const runs = await listRuns(project)
	return runs[0] ?? null
}

/**
 * Read source files for a project
 */
export async function readSourceFile(
	project: string,
	filename: string,
): Promise<string> {
	const filepath = join(getSourceDir(project), filename)
	return readFile(filepath, "utf-8")
}

/**
 * Write source file for a project
 */
export async function writeSourceFile(
	project: string,
	filename: string,
	content: string,
): Promise<void> {
	await ensureProjectDirs(project)
	const filepath = join(getSourceDir(project), filename)
	await writeFile(filepath, content)
}

/**
 * List source files for a project
 */
export async function listSourceFiles(project: string): Promise<string[]> {
	const sourceDir = getSourceDir(project)
	try {
		const entries = await readdir(sourceDir)
		return entries.filter(
			(f) => f.endsWith(".yml") || f.endsWith(".yaml") || f.endsWith(".json"),
		)
	} catch {
		return []
	}
}

/**
 * Save PNG file to run directory
 */
export async function savePngFile(
	project: string,
	runId: string,
	buffer: Buffer,
	suffix?: string,
): Promise<string> {
	const runDir = await ensureRunDir(project, runId)
	const filename = suffix ? `03-excalidraw-${suffix}.png` : "03-excalidraw.png"
	const filepath = join(runDir, filename)
	await writeFile(filepath, buffer)
	return filename
}

/**
 * Get PNG file path
 */
export function getPngPath(
	project: string,
	runId: string,
	suffix?: string,
): string {
	const runDir = getRunDir(project, runId)
	const filename = suffix ? `03-excalidraw-${suffix}.png` : "03-excalidraw.png"
	return join(runDir, filename)
}

/**
 * Load PNG file from run directory
 */
export async function loadPngFile(
	project: string,
	runId: string,
	suffix?: string,
): Promise<Buffer | null> {
	const filepath = getPngPath(project, runId, suffix)
	try {
		return await readFile(filepath)
	} catch {
		return null
	}
}

/**
 * Save Mermaid file to run directory
 */
export async function saveMermaidFile(
	project: string,
	runId: string,
	content: string,
	suffix?: string,
): Promise<string> {
	const runDir = await ensureRunDir(project, runId)
	const filename = suffix ? `${suffix}.mermaid` : "01-parsed.mermaid"
	const filepath = join(runDir, filename)
	await writeFile(filepath, content)
	return filename
}

/**
 * Load Mermaid file from run directory
 */
export async function loadMermaidFile(
	project: string,
	runId: string,
	suffix?: string,
): Promise<string | null> {
	const runDir = getRunDir(project, runId)
	const filename = suffix ? `${suffix}.mermaid` : "01-parsed.mermaid"
	const filepath = join(runDir, filename)
	try {
		return await readFile(filepath, "utf-8")
	} catch {
		return null
	}
}

/**
 * Save validation result for a specific resolution level
 */
export async function saveValidationResult(
	project: string,
	runId: string,
	result: VisualValidationResult,
	level: ResolutionLevel,
): Promise<string> {
	const runDir = await ensureRunDir(project, runId)
	const filename = `04-validation-${level}.json`
	const filepath = join(runDir, filename)
	await writeFile(filepath, JSON.stringify(result, null, 2))
	return filename
}

/**
 * Load validation result for a specific resolution level
 */
export async function loadValidationResult(
	project: string,
	runId: string,
	level: ResolutionLevel,
): Promise<VisualValidationResult | null> {
	const runDir = getRunDir(project, runId)
	const filename = `04-validation-${level}.json`
	const filepath = join(runDir, filename)
	try {
		const content = await readFile(filepath, "utf-8")
		return JSON.parse(content) as VisualValidationResult
	} catch {
		return null
	}
}

/**
 * Save validation summary
 */
export async function saveValidationSummary(
	project: string,
	runId: string,
	summary: ValidationSummary,
): Promise<string> {
	const runDir = await ensureRunDir(project, runId)
	const filename = "04-validation-summary.json"
	const filepath = join(runDir, filename)
	await writeFile(filepath, JSON.stringify(summary, null, 2))
	return filename
}

/**
 * Load validation summary
 */
export async function loadValidationSummary(
	project: string,
	runId: string,
): Promise<ValidationSummary | null> {
	const runDir = getRunDir(project, runId)
	const filename = "04-validation-summary.json"
	const filepath = join(runDir, filename)
	try {
		const content = await readFile(filepath, "utf-8")
		return JSON.parse(content) as ValidationSummary
	} catch {
		return null
	}
}
