import { parse as parseYaml } from "yaml"
import type { PortMapping, ResourceRequests } from "../../graph/types"

/**
 * Common values.yaml structure patterns
 */
export interface HelmValues {
	// Image configuration
	image?: {
		repository?: string
		tag?: string
		pullPolicy?: string
	}

	// Replicas
	replicaCount?: number

	// Service configuration
	service?: {
		type?: string
		port?: number
		ports?: Record<string, number>
	}

	// Container ports (Bitnami pattern)
	containerPorts?: Record<string, number>

	// Resource limits
	resources?: {
		requests?: {
			cpu?: string
			memory?: string
		}
		limits?: {
			cpu?: string
			memory?: string
		}
	}

	// Persistence
	persistence?: {
		enabled?: boolean
		size?: string
		storageClass?: string
	}

	// Nested component configurations
	[key: string]: unknown
}

/**
 * Parse values.yaml content
 */
export function parseValuesYaml(content: string): HelmValues {
	return parseYaml(content) as HelmValues
}

/**
 * Extract image reference from values
 * Supports patterns like:
 * - image.repository:image.tag
 * - image (string)
 * - <component>.image.repository:<component>.image.tag
 */
export function extractImage(
	values: HelmValues,
	componentPath?: string,
): string | undefined {
	// Try component-specific image first
	if (componentPath) {
		const component = getNestedValue(values, componentPath) as HelmValues | undefined
		if (component?.image) {
			return formatImage(component.image)
		}
	}

	// Fall back to top-level image
	if (values.image) {
		return formatImage(values.image)
	}

	return undefined
}

function formatImage(
	image: string | { repository?: string; tag?: string },
): string | undefined {
	if (typeof image === "string") {
		return image
	}

	const repo = image.repository
	const tag = image.tag

	if (repo) {
		return tag ? `${repo}:${tag}` : repo
	}

	return undefined
}

/**
 * Extract ports from values
 * Supports patterns like:
 * - service.port (single port)
 * - service.ports.http, service.ports.https (named ports)
 * - containerPorts.http, containerPorts.https (Bitnami pattern)
 */
export function extractPorts(
	values: HelmValues,
	componentPath?: string,
): PortMapping[] {
	const ports: PortMapping[] = []

	// Get component or root values
	const target = componentPath
		? (getNestedValue(values, componentPath) as HelmValues | undefined) ?? values
		: values

	// Single service port
	if (target.service?.port) {
		ports.push({ internal: target.service.port })
	}

	// Named service ports
	if (target.service?.ports) {
		for (const port of Object.values(target.service.ports)) {
			if (typeof port === "number") {
				ports.push({ internal: port })
			}
		}
	}

	// Container ports (Bitnami pattern)
	if (target.containerPorts) {
		for (const port of Object.values(target.containerPorts)) {
			if (typeof port === "number" && !ports.some((p) => p.internal === port)) {
				ports.push({ internal: port })
			}
		}
	}

	return ports
}

/**
 * Extract replica count from values
 */
export function extractReplicas(
	values: HelmValues,
	componentPath?: string,
): number | undefined {
	// Get component or root values
	const target = componentPath
		? (getNestedValue(values, componentPath) as HelmValues | undefined) ?? values
		: values

	return target.replicaCount ?? undefined
}

/**
 * Extract resource requests from values
 */
export function extractResourceRequests(
	values: HelmValues,
	componentPath?: string,
): ResourceRequests | undefined {
	// Get component or root values
	const target = componentPath
		? (getNestedValue(values, componentPath) as HelmValues | undefined) ?? values
		: values

	const requests = target.resources?.requests
	if (!requests) {
		return undefined
	}

	const result: ResourceRequests = {}
	if (requests.cpu) result.cpu = requests.cpu
	if (requests.memory) result.memory = requests.memory

	return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Extract storage size from persistence config
 */
export function extractStorageSize(
	values: HelmValues,
	componentPath?: string,
): string | undefined {
	// Get component or root values
	const target = componentPath
		? (getNestedValue(values, componentPath) as HelmValues | undefined) ?? values
		: values

	if (target.persistence?.enabled !== false && target.persistence?.size) {
		return target.persistence.size
	}

	return undefined
}

/**
 * Check for external database configuration (when built-in is disabled)
 */
export function getExternalDatabaseConfig(
	values: HelmValues,
): { host?: string; port?: number; database?: string } | undefined {
	const extDb = values.externalDatabase as
		| { host?: string; port?: number; database?: string }
		| undefined

	if (extDb?.host) {
		return {
			host: extDb.host,
			port: extDb.port,
			database: extDb.database,
		}
	}

	return undefined
}

/**
 * Check for external cache/Redis configuration
 */
export function getExternalRedisConfig(
	values: HelmValues,
): { host?: string; port?: number } | undefined {
	const extRedis = values.externalRedis as
		| { host?: string; port?: number }
		| undefined

	if (extRedis?.host) {
		return {
			host: extRedis.host,
			port: extRedis.port,
		}
	}

	return undefined
}

/**
 * Get a nested value from an object using dot notation
 */
export function getNestedValue(
	obj: Record<string, unknown>,
	path: string,
): unknown {
	const parts = path.split(".")
	let current: unknown = obj

	for (const part of parts) {
		if (current === null || typeof current !== "object") {
			return undefined
		}
		current = (current as Record<string, unknown>)[part]
	}

	return current
}
