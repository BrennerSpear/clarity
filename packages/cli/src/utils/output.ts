import type { InfraGraph } from "@ite/core"
import type { PipelineRun, StepResult } from "@ite/core"

/**
 * Format a duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
	return `${(ms / 60000).toFixed(1)}m`
}

/**
 * Format a step result for console output
 */
export function formatStepResult(step: StepResult): string {
	const status =
		step.status === "completed"
			? "\x1b[32m✓\x1b[0m"
			: step.status === "failed"
				? "\x1b[31m✗\x1b[0m"
				: step.status === "running"
					? "\x1b[33m⋯\x1b[0m"
					: "○"

	const duration = step.duration ? ` (${formatDuration(step.duration)})` : ""
	const error = step.error ? `\n    Error: ${step.error}` : ""

	return `  ${status} ${step.step}${duration}${error}`
}

/**
 * Format a pipeline run summary
 */
export function formatRunSummary(run: PipelineRun): string {
	const lines: string[] = []

	const statusColor =
		run.status === "completed"
			? "\x1b[32m"
			: run.status === "failed"
				? "\x1b[31m"
				: "\x1b[33m"
	const resetColor = "\x1b[0m"

	lines.push(`Run: ${run.id}`)
	lines.push(`Project: ${run.project}`)
	lines.push(`Status: ${statusColor}${run.status}${resetColor}`)
	lines.push(`Started: ${run.startedAt}`)
	if (run.completedAt) {
		lines.push(`Completed: ${run.completedAt}`)
	}
	lines.push("")
	lines.push("Steps:")
	for (const step of run.steps) {
		lines.push(formatStepResult(step))
	}

	return lines.join("\n")
}

/**
 * Format graph summary
 */
export function formatGraphSummary(graph: InfraGraph): string {
	const lines: string[] = []

	lines.push(`Nodes: ${graph.nodes.length}`)
	lines.push(`Edges: ${graph.edges.length}`)
	lines.push("")

	// Group nodes by type
	const byType = new Map<string, number>()
	for (const node of graph.nodes) {
		byType.set(node.type, (byType.get(node.type) ?? 0) + 1)
	}

	lines.push("Node types:")
	for (const [type, count] of byType.entries()) {
		lines.push(`  ${type}: ${count}`)
	}

	lines.push("")
	lines.push("Services:")
	for (const node of graph.nodes) {
		const deps = graph.edges.filter((e) => e.from === node.id).length
		const depsStr = deps > 0 ? ` (${deps} dependencies)` : ""
		lines.push(`  - ${node.name} [${node.type}]${depsStr}`)
	}

	return lines.join("\n")
}
