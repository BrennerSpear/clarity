import { parse as parseYaml } from "yaml"

/**
 * Helm Chart.yaml structure
 */
export interface HelmChartYaml {
	apiVersion?: string
	name: string
	version?: string
	appVersion?: string
	description?: string
	type?: "application" | "library"
	dependencies?: HelmChartDependency[]
	keywords?: string[]
	maintainers?: { name: string; email?: string; url?: string }[]
}

/**
 * Chart dependency declaration
 */
export interface HelmChartDependency {
	name: string
	version?: string
	repository?: string
	condition?: string // e.g., "postgresql.enabled"
	tags?: string[]
	alias?: string
}

/**
 * Parse Chart.yaml content
 */
export function parseChartYaml(content: string): HelmChartYaml {
	const chart = parseYaml(content) as HelmChartYaml

	if (!chart.name) {
		throw new Error("Chart.yaml must have a name field")
	}

	return chart
}

/**
 * Check if a dependency is enabled based on its condition and values
 */
export function isDependencyEnabled(
	dep: HelmChartDependency,
	values: Record<string, unknown>,
): boolean {
	// If no condition specified, dependency is enabled by default
	if (!dep.condition) {
		return true
	}

	// Parse condition like "postgresql.enabled" into path
	const parts = dep.condition.split(".")
	let current: unknown = values

	for (const part of parts) {
		if (current === null || typeof current !== "object") {
			// Path doesn't exist, use default (enabled)
			return true
		}
		current = (current as Record<string, unknown>)[part]
	}

	// If we reach the value, check if it's truthy
	return current !== false
}
