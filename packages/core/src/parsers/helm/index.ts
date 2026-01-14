import { GraphBuilder } from "../../graph/builder"
import type { InfraGraph, ServiceType } from "../../graph/types"
import {
	type HelmChartDependency,
	type HelmChartYaml,
	isDependencyEnabled,
	parseChartYaml,
} from "./chart"
import { type HelmComponent, detectComponents } from "./components"
import {
	type HelmValues,
	extractImage,
	extractPorts,
	extractReplicas,
	extractResourceRequests,
	extractStorageSize,
	getExternalDatabaseConfig,
	getExternalRedisConfig,
	parseValuesYaml,
} from "./values"

export { parseChartYaml } from "./chart"
export type { HelmChartYaml, HelmChartDependency } from "./chart"
export { parseValuesYaml } from "./values"
export type { HelmValues } from "./values"
export { detectComponents } from "./components"
export type { HelmComponent } from "./components"

/**
 * Parsed Helm chart files
 */
export interface HelmChartFiles {
	chartYaml: string
	valuesYaml: string
}

/**
 * Infer service type from dependency/image name
 */
function inferServiceType(name: string, image?: string): ServiceType {
	const n = (image ?? name).toLowerCase()

	// Databases
	if (
		n.includes("postgres") ||
		n.includes("mysql") ||
		n.includes("mariadb") ||
		n.includes("mongo") ||
		n.includes("clickhouse") ||
		n.includes("cassandra") ||
		n.includes("cockroach")
	) {
		return "database"
	}

	// Caches
	if (
		n.includes("redis") ||
		n.includes("memcache") ||
		n.includes("keydb") ||
		n.includes("valkey")
	) {
		return "cache"
	}

	// Search (categorized as cache for diagram simplicity)
	if (n.includes("elasticsearch") || n.includes("opensearch") || n.includes("solr")) {
		return "cache"
	}

	// Message queues
	if (
		n.includes("kafka") ||
		n.includes("rabbitmq") ||
		n.includes("nats") ||
		n.includes("pulsar") ||
		n.includes("zookeeper")
	) {
		return "queue"
	}

	// Storage
	if (
		n.includes("minio") ||
		n.includes("seaweed") ||
		n.includes("s3") ||
		n.includes("gcs") ||
		n.includes("ceph")
	) {
		return "storage"
	}

	// Proxies
	if (
		n.includes("nginx") ||
		n.includes("traefik") ||
		n.includes("haproxy") ||
		n.includes("envoy") ||
		n.includes("caddy")
	) {
		return "proxy"
	}

	// Worker patterns
	if (
		n.includes("worker") ||
		n.includes("scheduler") ||
		n.includes("sidekiq") ||
		n.includes("celery") ||
		n.includes("beat")
	) {
		return "container"
	}

	// UI/Web patterns
	if (n.includes("web") || n.includes("frontend") || n.includes("ui")) {
		return "ui"
	}

	return "container"
}

/**
 * Parse a Helm chart directory into an InfraGraph
 *
 * @param files - Chart.yaml and values.yaml content
 * @param chartDir - Directory name (used for naming)
 * @param project - Project ID
 */
export function parseHelmChart(
	files: HelmChartFiles,
	chartDir: string,
	project: string,
): InfraGraph {
	const chart = parseChartYaml(files.chartYaml)
	const values = parseValuesYaml(files.valuesYaml)

	const builder = new GraphBuilder(project)
	builder.addSourceFile(`${chartDir}/Chart.yaml`)
	builder.addSourceFile(`${chartDir}/values.yaml`)

	// Detect multi-component structure
	const components = detectComponents(values)
	const hasComponents = components.length > 0

	if (hasComponents) {
		// Multi-component chart: create nodes for each component
		addComponentNodes(builder, chart, values, components, chartDir)
	} else {
		// Single-service chart: create one node for the main service
		addMainServiceNode(builder, chart, values, chartDir)
	}

	// Add dependency nodes
	addDependencyNodes(builder, chart, values, chartDir)

	return builder.build()
}

/**
 * Add the main service node (single-component chart)
 */
function addMainServiceNode(
	builder: GraphBuilder,
	chart: HelmChartYaml,
	values: HelmValues,
	chartDir: string,
): void {
	const image = extractImage(values)
	const type = inferServiceType(chart.name, image)
	const ports = extractPorts(values)
	const replicas = extractReplicas(values)
	const resourceRequests = extractResourceRequests(values)
	const storageSize = extractStorageSize(values)

	builder.addNode(
		chart.name,
		chart.name,
		type,
		{ file: `${chartDir}/values.yaml`, format: "helm" },
		{
			image,
			ports: ports.length > 0 ? ports : undefined,
			replicas,
			resourceRequests,
			storageSize,
		},
	)
}

/**
 * Add nodes for each component in a multi-component chart
 */
function addComponentNodes(
	builder: GraphBuilder,
	chart: HelmChartYaml,
	values: HelmValues,
	components: HelmComponent[],
	chartDir: string,
): void {
	for (const component of components) {
		const id = `${chart.name}-${component.name}`
		const image = extractImage(values, component.path)
		const type = inferServiceType(component.name, image)
		const ports = extractPorts(values, component.path)
		const replicas = extractReplicas(values, component.path)
		const resourceRequests = extractResourceRequests(values, component.path)
		const storageSize = extractStorageSize(values, component.path)

		builder.addNode(
			id,
			component.name,
			type,
			{ file: `${chartDir}/values.yaml`, format: "helm" },
			{
				image,
				ports: ports.length > 0 ? ports : undefined,
				replicas,
				resourceRequests,
				storageSize,
				group: chart.name, // Group components under chart name
			},
		)
	}
}

/**
 * Add nodes for chart dependencies (subcharts)
 */
function addDependencyNodes(
	builder: GraphBuilder,
	chart: HelmChartYaml,
	values: HelmValues,
	chartDir: string,
): void {
	if (!chart.dependencies) return

	// Get all main service/component IDs to create edges from
	const mainNodeIds = builder.hasNode(chart.name)
		? [chart.name]
		: Array.from(
				(function* () {
					// Get all nodes that were added (components)
					const graph = builder.build()
					for (const node of graph.nodes) {
						yield node.id
					}
				})(),
			)

	for (const dep of chart.dependencies) {
		const enabled = isDependencyEnabled(dep, values)
		const depName = dep.alias ?? dep.name

		if (enabled) {
			// Dependency is enabled - create node for subchart
			const type = inferServiceType(depName)
			const depValues = values[depName] as HelmValues | undefined

			// Extract config from dependency's values section
			const image = depValues ? extractImage(depValues) : undefined
			const replicas = depValues ? extractReplicas(depValues) : undefined
			const resourceRequests = depValues
				? extractResourceRequests(depValues)
				: undefined
			const storageSize = depValues ? extractStorageSize(depValues) : undefined

			builder.addNode(
				depName,
				depName,
				type,
				{ file: `${chartDir}/Chart.yaml`, format: "helm" },
				{
					image,
					replicas,
					resourceRequests,
					storageSize,
				},
			)

			// Add edges from main service(s) to this dependency
			for (const mainId of mainNodeIds) {
				builder.addEdge(mainId, depName, "subchart")
			}
		} else {
			// Dependency is disabled - check for external service config
			addExternalServiceNode(builder, dep, values, chartDir, mainNodeIds)
		}
	}
}

/**
 * Add external service node when built-in dependency is disabled
 */
function addExternalServiceNode(
	builder: GraphBuilder,
	dep: HelmChartDependency,
	values: HelmValues,
	chartDir: string,
	mainNodeIds: string[],
): void {
	const depName = dep.alias ?? dep.name
	const lowerName = depName.toLowerCase()

	// Check for external database config
	if (
		lowerName.includes("postgres") ||
		lowerName.includes("mysql") ||
		lowerName.includes("mariadb")
	) {
		const extDb = getExternalDatabaseConfig(values)
		if (extDb?.host) {
			const id = `external-${depName}`
			builder.addNode(
				id,
				extDb.host,
				"database",
				{ file: `${chartDir}/values.yaml`, format: "helm" },
				{
					external: true,
					ports: extDb.port ? [{ internal: extDb.port }] : undefined,
				},
			)

			for (const mainId of mainNodeIds) {
				builder.addEdge(mainId, id, "inferred")
			}
		}
	}

	// Check for external Redis config
	if (lowerName.includes("redis") || lowerName.includes("cache")) {
		const extRedis = getExternalRedisConfig(values)
		if (extRedis?.host) {
			const id = `external-${depName}`
			builder.addNode(
				id,
				extRedis.host,
				"cache",
				{ file: `${chartDir}/values.yaml`, format: "helm" },
				{
					external: true,
					ports: extRedis.port ? [{ internal: extRedis.port }] : undefined,
				},
			)

			for (const mainId of mainNodeIds) {
				builder.addEdge(mainId, id, "inferred")
			}
		}
	}
}

/**
 * Parse Helm chart from separate file contents
 * Convenience wrapper for parseHelmChart
 */
export function parseHelm(
	chartYamlContent: string,
	valuesYamlContent: string,
	chartDir: string,
	project: string,
): InfraGraph {
	return parseHelmChart(
		{
			chartYaml: chartYamlContent,
			valuesYaml: valuesYamlContent,
		},
		chartDir,
		project,
	)
}
