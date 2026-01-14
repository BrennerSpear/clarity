import { existsSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { GraphBuilder } from "../../graph/builder"
import type { DependencyType, InfraGraph, PortMapping } from "../../graph/types"
import { inferServiceType } from "../utils"
import type { HelmDependency } from "./chart"
import { parseChartYaml } from "./chart"
import { detectComponents } from "./components"
import {
	extractServiceConfig,
	getBoolean,
	getNumber,
	getString,
	getValueAtPath,
	isRecord,
	parseValuesYaml,
	type HelmValues,
} from "./values"

interface ExternalServiceConfig {
	name: string
	port?: number
}

function buildEmptyGraph(
	project: string,
	sourceFiles: string[] = [],
): InfraGraph {
	return {
		nodes: [],
		edges: [],
		metadata: {
			project,
			parsedAt: new Date().toISOString(),
			sourceFiles,
			parserVersion: "0.1.0",
		},
	}
}

function resolveChartPath(chartDir: string): string | null {
	const yamlPath = join(chartDir, "Chart.yaml")
	if (existsSync(yamlPath)) return yamlPath
	const ymlPath = join(chartDir, "Chart.yml")
	if (existsSync(ymlPath)) return ymlPath
	return null
}

function resolveSourcePath(
	sourceRoot: string | undefined,
	filepath: string,
): string {
	if (!sourceRoot) return filepath
	const rel = relative(sourceRoot, filepath)
	return rel || filepath
}

function parseConditionPaths(condition?: string): string[] {
	if (!condition) return []
	return condition
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
}

function evaluateConditions(
	values: HelmValues,
	condition?: string,
): boolean | undefined {
	const paths = parseConditionPaths(condition)
	if (paths.length === 0) return undefined

	const results = paths
		.map((path) => getBoolean(getValueAtPath(values, path)))
		.filter((val): val is boolean => val !== undefined)

	if (results.length === 0) return undefined
	if (results.some((val) => val)) return true
	return false
}

function evaluateTags(
	values: HelmValues,
	tags?: string[],
): boolean | undefined {
	if (!tags || tags.length === 0) return undefined

	const results = tags
		.map((tag) => getBoolean(getValueAtPath(values, `tags.${tag}`)))
		.filter((val): val is boolean => val !== undefined)

	if (results.length === 0) return undefined
	if (results.some((val) => val === false)) return false
	if (results.some((val) => val === true)) return true
	return undefined
}

function isDependencyEnabled(
	dependency: HelmDependency,
	values: HelmValues,
): boolean {
	const conditionResult = evaluateConditions(values, dependency.condition)
	if (conditionResult !== undefined) return conditionResult

	const tagResult = evaluateTags(values, dependency.tags)
	if (tagResult !== undefined) return tagResult

	const explicitEnabled = getBoolean(
		getValueAtPath(values, `${dependency.name}.enabled`),
	)

	return explicitEnabled ?? true
}

function extractExternalServiceConfig(
	values: HelmValues,
	dependencyName: string,
): ExternalServiceConfig | null {
	const nameLower = dependencyName.toLowerCase()
	const candidates: string[] = []

	if (nameLower.includes("postgres") || nameLower.includes("postgresql")) {
		candidates.push(
			"externalDatabase",
			"externalPostgresql",
			"externalPostgres",
		)
	} else if (nameLower.includes("redis")) {
		candidates.push("externalRedis")
	} else if (nameLower.includes("mysql")) {
		candidates.push("externalDatabase", "externalMysql")
	} else if (nameLower.includes("mariadb")) {
		candidates.push("externalDatabase", "externalMariadb")
	} else if (nameLower.includes("mongo")) {
		candidates.push("externalMongo")
	} else if (nameLower.includes("elasticsearch")) {
		candidates.push("externalElasticsearch")
	} else if (nameLower.includes("opensearch")) {
		candidates.push("externalOpensearch")
	} else if (nameLower.includes("rabbitmq")) {
		candidates.push("externalRabbitmq")
	} else if (nameLower.includes("kafka")) {
		candidates.push("externalKafka")
	} else {
		candidates.push(`external${dependencyName}`)
	}

	const externalRoot = isRecord(values.external) ? values.external : undefined

	for (const key of candidates) {
		const config = getValueAtPath(values, key)
		if (!isRecord(config)) continue

		const host = getString(config.host) ?? getString(config.hostname)
		if (!host) continue

		const port =
			getNumber(config.port) ??
			getNumber(config.servicePort) ??
			getNumber(config.redisPort) ??
			getNumber(config.databasePort)

		return {
			name: `${dependencyName} (external)`,
			port: port ? Math.round(port) : undefined,
		}
	}

	if (externalRoot && isRecord(externalRoot[dependencyName])) {
		const config = externalRoot[dependencyName] as Record<string, unknown>
		const host = getString(config.host) ?? getString(config.hostname)
		if (host) {
			const port = getNumber(config.port)
			return {
				name: `${dependencyName} (external)`,
				port: port ? Math.round(port) : undefined,
			}
		}
	}

	return null
}

function buildPortMappings(port?: number): PortMapping[] | undefined {
	if (!port) return undefined
	return [{ internal: port }]
}

export function parseHelmChart(
	chartDir: string,
	project: string,
	sourceRoot?: string,
): InfraGraph {
	const chartPath = resolveChartPath(chartDir)
	if (!chartPath) {
		return buildEmptyGraph(project)
	}

	const chartContent = readFileSync(chartPath, "utf-8")
	const chart = parseChartYaml(chartContent)
	if (!chart) {
		return buildEmptyGraph(project, [resolveSourcePath(sourceRoot, chartPath)])
	}

	const valuesPath = join(chartDir, "values.yaml")
	let values: HelmValues = {}
	if (existsSync(valuesPath)) {
		const valuesContent = readFileSync(valuesPath, "utf-8")
		values = parseValuesYaml(valuesContent)
	}

	const builder = new GraphBuilder(project)
	builder.addSourceFile(resolveSourcePath(sourceRoot, chartPath))
	if (existsSync(valuesPath)) {
		builder.addSourceFile(resolveSourcePath(sourceRoot, valuesPath))
	}

	const dependencyNames = chart.dependencies?.map((dep) => dep.name) ?? []
	const components = detectComponents(values, { dependencyNames })

	const chartConfig = extractServiceConfig(values)
	const chartImage = chartConfig.image
	const chartSource = {
		file: resolveSourcePath(sourceRoot, chartPath),
		format: "helm" as const,
	}

	const hasComponents = components.length > 0

	if (!hasComponents) {
		builder.addNode(
			chart.name,
			chart.name,
			inferServiceType(chart.name, chartImage),
			chartSource,
			{
				image: chartImage,
				ports: chartConfig.ports,
				replicas: chartConfig.replicas,
				resourceRequests: chartConfig.resourceRequests,
				storageSize: chartConfig.storageSize,
			},
		)
	}

	const dependencyTargets: { id: string; edgeType: DependencyType }[] = []

	for (const dependency of chart.dependencies ?? []) {
		const enabled = isDependencyEnabled(dependency, values)
		if (enabled) {
			const depId = dependency.name
			builder.addNode(
				depId,
				dependency.name,
				inferServiceType(dependency.name, dependency.name),
				chartSource,
			)
			dependencyTargets.push({ id: depId, edgeType: "subchart" })
		} else {
			const external = extractExternalServiceConfig(values, dependency.name)
			if (external) {
				const externalId = `external-${dependency.name}`
				builder.addNode(
					externalId,
					external.name,
					inferServiceType(dependency.name, dependency.name),
					chartSource,
					{
						external: true,
						ports: buildPortMappings(external.port),
					},
				)
				dependencyTargets.push({ id: externalId, edgeType: "depends_on" })
			}
		}
	}

	if (hasComponents) {
		for (const component of components) {
			const componentConfig = extractServiceConfig(component.values)
			const componentImage = componentConfig.image ?? chartImage
			const componentName = `${chart.name}-${component.name}`
			const componentType = inferServiceType(component.name, componentImage)

			builder.addNode(
				componentName,
				componentName,
				componentType,
				chartSource,
				{
					image: componentImage,
					ports: componentConfig.ports ?? chartConfig.ports,
					replicas: componentConfig.replicas ?? chartConfig.replicas,
					resourceRequests:
						componentConfig.resourceRequests ?? chartConfig.resourceRequests,
					storageSize: componentConfig.storageSize ?? chartConfig.storageSize,
					group: chart.name,
				},
			)

			for (const target of dependencyTargets) {
				builder.addEdge(componentName, target.id, target.edgeType)
			}
		}
	} else {
		for (const target of dependencyTargets) {
			builder.addEdge(chart.name, target.id, target.edgeType)
		}
	}

	return builder.build()
}
