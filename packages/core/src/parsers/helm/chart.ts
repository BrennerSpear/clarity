import { parse as parseYaml } from "yaml"

const yamlParseOptions = {
	maxAliasCount: -1,
	merge: true,
}

export interface HelmDependency {
	name: string
	version?: string
	repository?: string
	condition?: string
	tags?: string[]
}

export interface HelmChart {
	name: string
	version?: string
	appVersion?: string
	description?: string
	dependencies?: HelmDependency[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseDependencies(value: unknown): HelmDependency[] {
	if (!Array.isArray(value)) return []

	const deps: HelmDependency[] = []
	for (const item of value) {
		if (!isRecord(item)) continue
		const name = typeof item.name === "string" ? item.name : undefined
		if (!name) continue

		const tags =
			Array.isArray(item.tags) && item.tags.every((t) => typeof t === "string")
				? (item.tags as string[])
				: undefined

		deps.push({
			name,
			version: typeof item.version === "string" ? item.version : undefined,
			repository:
				typeof item.repository === "string" ? item.repository : undefined,
			condition:
				typeof item.condition === "string" ? item.condition : undefined,
			tags,
		})
	}

	return deps
}

export function parseChartYaml(content: string): HelmChart | null {
	const chart = parseYaml(content, yamlParseOptions)
	if (!isRecord(chart)) return null

	const name = typeof chart.name === "string" ? chart.name : undefined
	if (!name) return null

	return {
		name,
		version: typeof chart.version === "string" ? chart.version : undefined,
		appVersion:
			typeof chart.appVersion === "string" ? chart.appVersion : undefined,
		description:
			typeof chart.description === "string" ? chart.description : undefined,
		dependencies: parseDependencies(chart.dependencies),
	}
}
