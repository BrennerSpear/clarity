import { parse as parseYaml } from "yaml"
import type { PortMapping } from "../../graph/types"

const yamlParseOptions = {
	maxAliasCount: -1,
	merge: true,
}

export type HelmValues = Record<string, unknown>

export function parseValuesYaml(content: string): HelmValues {
	const values = parseYaml(content, yamlParseOptions)
	if (!isRecord(values)) return {}
	return values
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function getValueAtPath(
	values: HelmValues,
	path: string,
): unknown | undefined {
	const parts = path.split(".").filter(Boolean)
	let current: unknown = values

	for (const part of parts) {
		if (!isRecord(current)) return undefined
		current = current[part]
	}

	return current
}

export function getString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined
}

export function getNumber(value: unknown): number | undefined {
	if (typeof value === "number")
		return Number.isFinite(value) ? value : undefined
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value)
		return Number.isFinite(parsed) ? parsed : undefined
	}
	return undefined
}

export function getBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value
	if (typeof value === "string") {
		if (value.toLowerCase() === "true") return true
		if (value.toLowerCase() === "false") return false
	}
	return undefined
}

export interface ServiceValuesConfig {
	image?: string
	ports?: PortMapping[]
	replicas?: number
	resourceRequests?: {
		cpu?: string
		memory?: string
	}
	storageSize?: string
}

function normalizeRegistry(repository: string, registry?: string): string {
	if (!registry) return repository
	if (repository.includes("/")) return repository
	return `${registry}/${repository}`
}

export function extractImage(values: HelmValues): string | undefined {
	const image = values.image

	if (typeof image === "string") {
		return image
	}

	if (isRecord(image)) {
		const repository = getString(image.repository) ?? getString(image.name)
		if (!repository) return undefined

		const registry =
			getString(image.registry) ??
			getString(getValueAtPath(values, "global.imageRegistry"))
		const normalizedRepo = normalizeRegistry(repository, registry)

		const tag = getString(image.tag)
		if (tag && !normalizedRepo.includes(":")) {
			return `${normalizedRepo}:${tag}`
		}

		return normalizedRepo
	}

	return undefined
}

function parsePortValue(value: unknown): PortMapping[] {
	const mappings: PortMapping[] = []

	if (typeof value === "number") {
		mappings.push({ internal: value })
		return mappings
	}

	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10)
		if (!Number.isNaN(parsed)) {
			mappings.push({ internal: parsed })
		}
		return mappings
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			mappings.push(...parsePortValue(entry))
		}
		return mappings
	}

	if (isRecord(value)) {
		const port = getNumber(value.port)
		const targetPort =
			getNumber(value.targetPort) ??
			getNumber(value.containerPort) ??
			getNumber(value.containerPorts)

		if (port && targetPort) {
			mappings.push({ internal: targetPort, external: port })
			return mappings
		}

		if (targetPort) {
			mappings.push({ internal: targetPort })
			return mappings
		}

		if (port) {
			mappings.push({ internal: port })
			return mappings
		}

		for (const entry of Object.values(value)) {
			mappings.push(...parsePortValue(entry))
		}
	}

	return mappings
}

export function extractPorts(values: HelmValues): PortMapping[] | undefined {
	const ports: PortMapping[] = []

	const service = isRecord(values.service) ? values.service : undefined
	if (service) {
		if ("ports" in service) {
			ports.push(...parsePortValue(service.ports))
		}
		if ("port" in service) {
			ports.push(...parsePortValue(service.port))
		}
	}

	if ("containerPorts" in values) {
		ports.push(...parsePortValue(values.containerPorts))
	}
	if ("containerPort" in values) {
		ports.push(...parsePortValue(values.containerPort))
	}

	if ("ports" in values) {
		ports.push(...parsePortValue(values.ports))
	}

	// De-duplicate port mappings
	const seen = new Set<string>()
	const deduped: PortMapping[] = []
	for (const mapping of ports) {
		const key = `${mapping.external ?? "internal"}-${mapping.internal}`
		if (seen.has(key)) continue
		seen.add(key)
		deduped.push(mapping)
	}

	return deduped.length ? deduped : undefined
}

export function extractReplicas(values: HelmValues): number | undefined {
	const replicaCount =
		getNumber(values.replicaCount) ?? getNumber(values.replicas)
	return replicaCount !== undefined ? Math.round(replicaCount) : undefined
}

export function extractResourceRequests(
	values: HelmValues,
): ServiceValuesConfig["resourceRequests"] {
	const resources = isRecord(values.resources) ? values.resources : undefined
	const requests =
		resources && isRecord(resources.requests) ? resources.requests : undefined

	const cpu = getString(requests?.cpu)
	const memory = getString(requests?.memory)

	if (!cpu && !memory) return undefined
	return {
		cpu: cpu || undefined,
		memory: memory || undefined,
	}
}

export function extractStorageSize(values: HelmValues): string | undefined {
	const persistence = isRecord(values.persistence)
		? values.persistence
		: undefined
	if (!persistence) return undefined

	return (
		getString(persistence.size) ??
		getString(persistence.storageSize) ??
		getString(persistence.storage)
	)
}

export function extractServiceConfig(values: HelmValues): ServiceValuesConfig {
	return {
		image: extractImage(values),
		ports: extractPorts(values),
		replicas: extractReplicas(values),
		resourceRequests: extractResourceRequests(values),
		storageSize: extractStorageSize(values),
	}
}

// Connection-related keys that may contain service addresses
const CONNECTION_KEYS = new Set([
	"connectaddr",
	"host",
	"hostname",
	"address",
	"addr",
	"endpoint",
	"url",
	"uri",
	"server",
	"target",
])


export interface ValuesExternalService {
	id: string
	name: string
	port?: number
	serviceType: string // e.g., "postgres", "elasticsearch"
}

/**
 * Parse a Kubernetes DNS address and extract service name and port
 * Formats:
 *   - service.namespace.svc.cluster.local:port
 *   - service.namespace.svc:port
 *   - service:port
 *   - service.namespace.svc.cluster.local (no port)
 */
function parseK8sAddress(
	address: string,
): { serviceName: string; port?: number } | null {
	const trimmed = address.trim()
	if (!trimmed) return null

	// Skip localhost and IP addresses
	if (
		trimmed.startsWith("localhost") ||
		/^\d{1,3}(\.\d{1,3}){3}/.test(trimmed)
	) {
		return null
	}

	// Extract port if present
	let host = trimmed
	let port: number | undefined

	const portMatch = trimmed.match(/:(\d+)$/)
	if (portMatch?.[1]) {
		port = Number.parseInt(portMatch[1], 10)
		host = trimmed.slice(0, -portMatch[0].length)
	}

	// Parse Kubernetes DNS patterns
	// Full: service.namespace.svc.cluster.local
	// Partial: service.namespace.svc
	// Short: service.namespace or just service
	const parts = host.split(".")

	// Filter out cluster.local and svc suffixes
	const filteredParts = parts.filter(
		(part) => !["svc", "cluster", "local"].includes(part.toLowerCase()),
	)

	if (filteredParts.length === 0) return null

	// First part is always the service name
	const serviceName = filteredParts[0]
	if (!serviceName || serviceName.length < 2) return null

	// Skip if looks like a generic hostname pattern
	if (/^\d+$/.test(serviceName)) return null

	return { serviceName, port }
}

/**
 * Infer service type from context path and service name
 */
function inferServiceTypeFromContext(
	path: string[],
	serviceName: string,
): string {
	const pathStr = path.join(".").toLowerCase()
	const nameLower = serviceName.toLowerCase()

	// Check path for datastore hints
	if (
		pathStr.includes("postgres") ||
		pathStr.includes("postgresql") ||
		nameLower.includes("postgres")
	) {
		return "postgres"
	}
	if (pathStr.includes("mysql") || nameLower.includes("mysql")) {
		return "mysql"
	}
	if (pathStr.includes("cassandra") || nameLower.includes("cassandra")) {
		return "cassandra"
	}
	if (
		pathStr.includes("elasticsearch") ||
		pathStr.includes("opensearch") ||
		nameLower.includes("elasticsearch") ||
		nameLower.includes("opensearch")
	) {
		return "elasticsearch"
	}
	if (
		pathStr.includes("redis") ||
		nameLower.includes("redis") ||
		nameLower.includes("cache")
	) {
		return "redis"
	}
	if (pathStr.includes("kafka") || nameLower.includes("kafka")) {
		return "kafka"
	}
	if (pathStr.includes("rabbitmq") || nameLower.includes("rabbit")) {
		return "rabbitmq"
	}
	if (
		pathStr.includes("mongo") ||
		nameLower.includes("mongo") ||
		nameLower.includes("mongodb")
	) {
		return "mongodb"
	}
	if (
		pathStr.includes("memcached") ||
		nameLower.includes("memcache") ||
		nameLower.includes("memcached")
	) {
		return "memcached"
	}

	// Infer from common port numbers
	return "database"
}

/**
 * Recursively scan values for connection addresses
 */
function scanForConnections(
	values: HelmValues,
	path: string[] = [],
	results: Map<string, ValuesExternalService> = new Map(),
): Map<string, ValuesExternalService> {
	for (const [key, value] of Object.entries(values)) {
		const currentPath = [...path, key]
		const keyLower = key.toLowerCase()

		// Check if this key might contain a connection address
		if (CONNECTION_KEYS.has(keyLower) && typeof value === "string") {
			const parsed = parseK8sAddress(value)
			if (parsed) {
				const id = `external-${parsed.serviceName}`
				if (!results.has(id)) {
					results.set(id, {
						id,
						name: parsed.serviceName,
						port: parsed.port,
						serviceType: inferServiceTypeFromContext(
							currentPath,
							parsed.serviceName,
						),
					})
				}
			}
		}

		// Check for nested url.host pattern
		if (keyLower === "url" && isRecord(value)) {
			const host = getString(value.host) ?? getString(value.hostname)
			if (host) {
				const portNum = getNumber(value.port)
				const addressWithPort = portNum ? `${host}:${portNum}` : host
				const parsed = parseK8sAddress(addressWithPort)
				if (parsed) {
					const id = `external-${parsed.serviceName}`
					if (!results.has(id)) {
						results.set(id, {
							id,
							name: parsed.serviceName,
							port: parsed.port,
							serviceType: inferServiceTypeFromContext(
								currentPath,
								parsed.serviceName,
							),
						})
					}
				}
			}
		}

		// Recurse into nested objects, prioritizing datastore contexts
		if (isRecord(value)) {
			scanForConnections(value, currentPath, results)
		}

		// Handle arrays of objects
		if (Array.isArray(value)) {
			for (let i = 0; i < value.length; i++) {
				const item = value[i]
				if (isRecord(item)) {
					scanForConnections(item, [...currentPath, `[${i}]`], results)
				}
			}
		}
	}

	return results
}

/**
 * Extract external services referenced in values.yaml connection strings
 * Looks for Kubernetes DNS patterns in connection-related fields
 */
export function extractExternalServicesFromValues(
	values: HelmValues,
): ValuesExternalService[] {
	const results = scanForConnections(values)
	return Array.from(results.values())
}
