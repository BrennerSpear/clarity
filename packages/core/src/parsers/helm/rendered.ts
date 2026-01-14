import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { parseAllDocuments } from "yaml"
import type { DependencyType } from "../../graph/types"

const yamlParseOptions = {
	maxAliasCount: -1,
	merge: true,
}

export interface RenderedEdge {
	from: string
	to: string
	type: DependencyType
}

export interface ExternalService {
	id: string
	name: string
	port?: number
}

interface K8sResource {
	kind?: string
	metadata?: {
		name?: string
		labels?: Record<string, string>
	}
	spec?: Record<string, unknown>
}

interface PodSpec {
	containers?: Array<{
		env?: Array<{ name?: string; value?: string }>
		envFrom?: Array<{ configMapRef?: { name?: string } }>
		args?: string[]
		command?: string[]
	}>
	initContainers?: Array<{
		env?: Array<{ name?: string; value?: string }>
		envFrom?: Array<{ configMapRef?: { name?: string } }>
		args?: string[]
		command?: string[]
	}>
	volumes?: Array<{
		configMap?: { name?: string }
	}>
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeName(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/_/g, "-")
		.toLowerCase()
}

function renderHelmTemplate(
	chartDir: string,
	releaseName: string,
	valuesFiles: string[] = [],
	showOnly?: string,
): string | null {
	try {
		const args = ["template", releaseName, chartDir, "--namespace", "default"]
		for (const file of valuesFiles) {
			args.push("--values", file)
		}
		if (showOnly) {
			args.push("--show-only", showOnly)
		}

		return execFileSync(
			"helm",
			args,
			{
				encoding: "utf-8",
				maxBuffer: 20 * 1024 * 1024,
				stdio: ["ignore", "pipe", "pipe"],
			},
		)
	} catch {
		return null
	}
}

function listTemplateFiles(chartDir: string): string[] {
	const templatesDir = join(chartDir, "templates")
	try {
		const files: string[] = []
		const queue: Array<{ dir: string; relativeDir: string }> = [
			{ dir: templatesDir, relativeDir: "templates" },
		]

		while (queue.length) {
			const current = queue.pop()
			if (!current) continue
			const dirEntries = readdirSync(current.dir, { withFileTypes: true })
			for (const entry of dirEntries) {
				if (entry.name.startsWith("_")) continue
				if (entry.name === "NOTES.txt") continue
				const fullPath = join(current.dir, entry.name)
				const relPath = join(current.relativeDir, entry.name)
				if (entry.isDirectory()) {
					queue.push({ dir: fullPath, relativeDir: relPath })
					continue
				}
				if (
					entry.isFile() &&
					(entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))
				) {
					files.push(relPath)
				}
			}
		}

		return files
	} catch {
		return []
	}
}

function normalizeTemplateText(text: string, releaseName: string): string {
	let normalized = text

	normalized = normalized.replace(
		/{{\s*include\s+"[^"]+\.fullname"[^}]*}}/g,
		releaseName,
	)

	normalized = normalized.replace(
		/{{\s*include\s+"[^"]+\.componentname"\s*\(list\s+\$\s+"([^"]+)"\s*\)\s*}}/g,
		`${releaseName}-$1`,
	)

	return normalized
}

function resolveSourceFromTemplatePath(
	templatePath: string,
	componentMap: Map<string, string>,
	aliasMap: Map<string, string>,
): string | undefined {
	const base = templatePath.split("/").pop() ?? templatePath
	const normalized = normalizeName(base.replace(/\.ya?ml$/, ""))

	const aliasEntries = Array.from(aliasMap.entries()).sort(
		(a, b) => b[0].length - a[0].length,
	)
	for (const [alias, nodeId] of aliasEntries) {
		if (normalized.includes(alias)) {
			return nodeId
		}
	}

	const componentEntries = Array.from(componentMap.entries()).sort(
		(a, b) => b[0].length - a[0].length,
	)
	for (const [component, nodeId] of componentEntries) {
		if (normalized.includes(component)) {
			return nodeId
		}
	}

	return undefined
}

function buildServiceTargets(
	releaseName: string,
	componentMap: Map<string, string>,
	aliasMap: Map<string, string>,
): Map<string, string> {
	const targets = new Map<string, string>()

	for (const [component, nodeId] of componentMap) {
		targets.set(`${releaseName}-${component}`, nodeId)
	}

	for (const [alias, nodeId] of aliasMap) {
		targets.set(`${releaseName}-${alias}`, nodeId)
	}

	return targets
}

function inferEdgesFromTemplates(options: {
	chartDir: string
	releaseName: string
	componentMap: Map<string, string>
	aliasMap: Map<string, string>
}): { edges: RenderedEdge[]; externalServices: ExternalService[] } {
	const templates = listTemplateFiles(options.chartDir)
	if (templates.length === 0) {
		return { edges: [], externalServices: [] }
	}

	const serviceTargets = buildServiceTargets(
		options.releaseName,
		options.componentMap,
		options.aliasMap,
	)

	const edges: RenderedEdge[] = []
	const edgeKeys = new Set<string>()
	const externalServices = new Map<string, ExternalService>()

	for (const template of templates) {
		const sourceNode = resolveSourceFromTemplatePath(
			template,
			options.componentMap,
			options.aliasMap,
		)
		if (!sourceNode) continue

		let contents = ""
		try {
			contents = readFileSync(join(options.chartDir, template), "utf-8")
		} catch {
			continue
		}

		const normalized = normalizeTemplateText(contents, options.releaseName)
		const lines = normalized.split("\n")

		for (const line of lines) {
			for (const [serviceName, targetNode] of serviceTargets) {
				if (sourceNode === targetNode) continue
				if (!valueIncludesService(line, serviceName)) continue
				const key = `${sourceNode}->${targetNode}`
				if (edgeKeys.has(key)) continue
				edgeKeys.add(key)
				edges.push({ from: sourceNode, to: targetNode, type: "inferred" })
			}

			const matches = line.matchAll(/([a-zA-Z0-9.-]+):(\d{2,5})/g)
			for (const match of matches) {
				const host = match[1]
				const port = Number.parseInt(match[2] ?? "", 10)
				if (!host || Number.isNaN(port)) continue
				const normalizedHost = host.toLowerCase()
				const hostBase = normalizedHost.split(".")[0] ?? normalizedHost
				if (!hostBase) continue
				if (
					normalizedHost === "localhost" ||
					/^\d{1,3}(\.\d{1,3}){3}$/.test(normalizedHost) ||
					/^\d+$/.test(hostBase)
				) {
					continue
				}

				if (serviceTargets.has(hostBase) || serviceTargets.has(normalizedHost)) {
					const targetNode =
						serviceTargets.get(hostBase) ?? serviceTargets.get(normalizedHost)
					if (!targetNode || sourceNode === targetNode) continue
					const key = `${sourceNode}->${targetNode}`
					if (edgeKeys.has(key)) continue
					edgeKeys.add(key)
					edges.push({ from: sourceNode, to: targetNode, type: "inferred" })
					continue
				}

				const externalId = `external-${hostBase}`
				if (!externalServices.has(externalId)) {
					externalServices.set(externalId, {
						id: externalId,
						name: hostBase,
						port,
					})
				}

				const key = `${sourceNode}->${externalId}`
				if (edgeKeys.has(key)) continue
				edgeKeys.add(key)
				edges.push({ from: sourceNode, to: externalId, type: "inferred" })
			}
		}
	}

	return { edges, externalServices: Array.from(externalServices.values()) }
}

function parseRenderedResources(content: string): K8sResource[] {
	const documents = parseAllDocuments(content, yamlParseOptions)
	const resources: K8sResource[] = []
	for (const doc of documents) {
		const data = doc.toJSON() as unknown
		if (!isRecord(data)) continue
		resources.push(data as K8sResource)
	}
	return resources
}

function getLabels(resource: K8sResource): Record<string, string> {
	const metadataLabels =
		resource.metadata?.labels && isRecord(resource.metadata.labels)
			? (resource.metadata.labels as Record<string, string>)
			: {}
	const templateLabels = (() => {
		const spec = resource.spec
		if (!spec || !isRecord(spec)) return {}
		const template = spec.template
		if (!isRecord(template)) return {}
		const metadata = template.metadata
		if (!isRecord(metadata)) return {}
		const labels = metadata.labels
		if (!isRecord(labels)) return {}
		return labels as Record<string, string>
	})()

	return { ...metadataLabels, ...templateLabels }
}

function getPodSpec(resource: K8sResource): PodSpec | null {
	const spec = resource.spec
	if (!spec || !isRecord(spec)) return null

	switch (resource.kind) {
		case "Deployment":
		case "StatefulSet":
		case "DaemonSet":
		case "ReplicaSet":
			if (
				isRecord(spec.template) &&
				isRecord(spec.template.spec) &&
				spec.template.spec
			) {
				return spec.template.spec as PodSpec
			}
			return null
		case "Job":
			if (
				isRecord(spec.template) &&
				isRecord(spec.template.spec) &&
				spec.template.spec
			) {
				return spec.template.spec as PodSpec
			}
			return null
		case "CronJob": {
			const jobTemplate = spec.jobTemplate
			if (
				isRecord(jobTemplate) &&
				isRecord(jobTemplate.spec) &&
				isRecord(jobTemplate.spec.template) &&
				isRecord(jobTemplate.spec.template.spec)
			) {
				return jobTemplate.spec.template.spec as PodSpec
			}
			return null
		}
		case "Pod":
			if (isRecord(spec)) {
				return spec as PodSpec
			}
			return null
		default:
			return null
	}
}

function collectConfigMapNames(podSpec: PodSpec): string[] {
	const names: string[] = []

	for (const volume of podSpec.volumes ?? []) {
		const name = volume.configMap?.name
		if (name) names.push(name)
	}

	const containers = [
		...(podSpec.containers ?? []),
		...(podSpec.initContainers ?? []),
	]

	for (const container of containers) {
		for (const envFrom of container.envFrom ?? []) {
			const name = envFrom.configMapRef?.name
			if (name) names.push(name)
		}
	}

	return names
}

function collectStringsFromPodSpec(
	podSpec: PodSpec,
	configMaps: Map<string, string[]>,
): string[] {
	const values: string[] = []
	const containers = [
		...(podSpec.containers ?? []),
		...(podSpec.initContainers ?? []),
	]

	for (const container of containers) {
		for (const env of container.env ?? []) {
			if (typeof env.value === "string") {
				values.push(env.value)
			}
		}

		if (Array.isArray(container.args)) {
			values.push(...container.args.filter((value) => typeof value === "string"))
		}

		if (Array.isArray(container.command)) {
			values.push(
				...container.command.filter((value) => typeof value === "string"),
			)
		}
	}

	for (const name of collectConfigMapNames(podSpec)) {
		const data = configMaps.get(name)
		if (data) {
			values.push(...data)
		}
	}

	return values
}

function valueIncludesService(value: string, serviceName: string): boolean {
	const normalizedValue = value.toLowerCase()
	const normalizedService = serviceName.toLowerCase()
	const pattern = new RegExp(
		`(^|[\\s:/\"'=\\(])${normalizedService.replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&")}(?=$|[\\s:/\"'=.\\)])`,
		"i",
	)
	return (
		normalizedValue.includes(normalizedService) &&
		pattern.test(normalizedValue)
	)
}

function resolveNodeIdFromComponent(
	component: string | undefined,
	componentMap: Map<string, string>,
	aliasMap: Map<string, string>,
): string | undefined {
	if (!component) return undefined
	const normalized = normalizeName(component)
	return componentMap.get(normalized) ?? aliasMap.get(normalized)
}

function resolveNodeIdFromName(
	resourceName: string | undefined,
	componentMap: Map<string, string>,
	aliasMap: Map<string, string>,
): string | undefined {
	if (!resourceName) return undefined
	const normalized = normalizeName(resourceName)

	for (const [component, nodeId] of componentMap) {
		if (normalized === component || normalized.endsWith(`-${component}`)) {
			return nodeId
		}
	}

	for (const [alias, nodeId] of aliasMap) {
		if (normalized === alias || normalized.endsWith(`-${alias}`)) {
			return nodeId
		}
	}

	return undefined
}

export function inferEdgesFromRenderedManifests(options: {
	chartDir: string
	releaseName: string
	componentMap: Map<string, string>
	aliasMap: Map<string, string>
	valuesFiles?: string[]
}): { edges: RenderedEdge[]; externalServices: ExternalService[] } {
	const manifest = renderHelmTemplate(
		options.chartDir,
		options.releaseName,
		options.valuesFiles ?? [],
	)
	if (!manifest) {
		console.warn(
			"Helm render failed; falling back to static template scanning. Some dependencies may be missing.",
		)
		return inferEdgesFromTemplates(options)
	}

	const resources = parseRenderedResources(manifest)
	const serviceTargets = new Map<string, string>()
	const configMaps = new Map<string, string[]>()
	const externalServices = new Map<string, ExternalService>()

	for (const resource of resources) {
		if (resource.kind === "ConfigMap" && resource.metadata?.name) {
			const rawData = (resource as { data?: Record<string, unknown> }).data
			if (isRecord(rawData)) {
				const strings = Object.values(rawData).filter(
					(value): value is string => typeof value === "string",
				)
				if (strings.length > 0) {
					configMaps.set(resource.metadata.name, strings)
				}
			}
		}

		const labels = getLabels(resource)
		const componentLabel = labels["app.kubernetes.io/component"] ?? labels.app
		const resolvedNode =
			resolveNodeIdFromComponent(
				componentLabel,
				options.componentMap,
				options.aliasMap,
			) ??
			resolveNodeIdFromName(resource.metadata?.name, options.componentMap, options.aliasMap)

		if (!resolvedNode) continue

		if (resource.kind === "Service" && resource.metadata?.name) {
			serviceTargets.set(resource.metadata.name, resolvedNode)
		}

		// workloads are handled in a separate pass
	}

	const edges: RenderedEdge[] = []
	const edgeKeys = new Set<string>()
	const serviceNames = new Set<string>()

	for (const [serviceName] of serviceTargets) {
		serviceNames.add(serviceName.toLowerCase())
	}

	for (const resource of resources) {
		if (
			![
				"Deployment",
				"StatefulSet",
				"DaemonSet",
				"ReplicaSet",
				"Job",
				"CronJob",
				"Pod",
			].includes(resource.kind ?? "")
		) {
			continue
		}

		const labels = getLabels(resource)
		const componentLabel = labels["app.kubernetes.io/component"] ?? labels.app
		const sourceNode =
			resolveNodeIdFromComponent(
				componentLabel,
				options.componentMap,
				options.aliasMap,
			) ??
			resolveNodeIdFromName(resource.metadata?.name, options.componentMap, options.aliasMap)

		if (!sourceNode) continue

		const podSpec = getPodSpec(resource)
		if (!podSpec) continue

		const strings = collectStringsFromPodSpec(podSpec, configMaps)
		if (strings.length === 0) continue

		for (const [serviceName, targetNode] of serviceTargets) {
			if (sourceNode === targetNode) continue
			for (const value of strings) {
				if (!valueIncludesService(value, serviceName)) continue
				const key = `${sourceNode}->${targetNode}`
				if (edgeKeys.has(key)) continue
				edgeKeys.add(key)
				edges.push({ from: sourceNode, to: targetNode, type: "inferred" })
			}
		}

		for (const value of strings) {
			const matches = value.matchAll(/([a-zA-Z0-9.-]+):(\d{2,5})/g)
			for (const match of matches) {
				const host = match[1]
				const port = Number.parseInt(match[2] ?? "", 10)
				if (!host || Number.isNaN(port)) continue
				const normalizedHost = host.toLowerCase()
				const hostBase = normalizedHost.split(".")[0] ?? normalizedHost
				if (!hostBase) continue
				if (
					normalizedHost === "localhost" ||
					/^\d{1,3}(\.\d{1,3}){3}$/.test(normalizedHost) ||
					/^\d+$/.test(hostBase)
				) {
					continue
				}

				if (serviceNames.has(hostBase) || serviceNames.has(normalizedHost)) {
					const targetNode = serviceTargets.get(hostBase) ?? serviceTargets.get(normalizedHost)
					if (!targetNode || sourceNode === targetNode) continue
					const key = `${sourceNode}->${targetNode}`
					if (edgeKeys.has(key)) continue
					edgeKeys.add(key)
					edges.push({ from: sourceNode, to: targetNode, type: "inferred" })
					continue
				}

				const externalId = `external-${hostBase}`
				if (!externalServices.has(externalId)) {
					externalServices.set(externalId, {
						id: externalId,
						name: hostBase,
						port,
					})
				}

				const key = `${sourceNode}->${externalId}`
				if (edgeKeys.has(key)) continue
				edgeKeys.add(key)
				edges.push({ from: sourceNode, to: externalId, type: "inferred" })
			}
		}
	}

	return { edges, externalServices: Array.from(externalServices.values()) }
}
