import { parse as parseYaml } from "yaml"

// Parser options for handling complex docker-compose files with many aliases
const yamlParseOptions = {
	// Allow unlimited aliases for complex docker-compose files like Sentry
	maxAliasCount: -1,
	// Enable YAML merge key (<<) support for docker-compose anchor inheritance
	merge: true,
}
import { GraphBuilder } from "../graph/builder"
import type {
	InfraGraph,
	PortMapping,
	ServiceType,
	VolumeMount,
} from "../graph/types"

interface DockerComposeService {
	image?: string
	build?: string | { context?: string; dockerfile?: string }
	ports?: (string | { target?: number; published?: number })[]
	volumes?: (string | { source?: string; target?: string; type?: string })[]
	environment?: Record<string, string> | string[]
	depends_on?: string[] | Record<string, { condition?: string }>
	links?: string[]
	networks?: string[] | Record<string, unknown>
	deploy?: { replicas?: number }
}

interface DockerComposeFile {
	version?: string
	services?: Record<string, DockerComposeService>
	networks?: Record<string, unknown>
	volumes?: Record<string, unknown>
}

/**
 * Infer service type from image name
 */
function inferServiceType(
	serviceName: string,
	image?: string,
): ServiceType {
	const name = (image ?? serviceName).toLowerCase()

	// Databases
	if (
		name.includes("postgres") ||
		name.includes("mysql") ||
		name.includes("mariadb") ||
		name.includes("mongo") ||
		name.includes("clickhouse") ||
		name.includes("cassandra") ||
		name.includes("cockroach")
	) {
		return "database"
	}

	// Caches
	if (
		name.includes("redis") ||
		name.includes("memcache") ||
		name.includes("keydb")
	) {
		return "cache"
	}

	// Message queues
	if (
		name.includes("kafka") ||
		name.includes("rabbitmq") ||
		name.includes("nats") ||
		name.includes("pulsar") ||
		name.includes("zookeeper")
	) {
		return "queue"
	}

	// Storage
	if (
		name.includes("minio") ||
		name.includes("s3") ||
		name.includes("gcs") ||
		name.includes("ceph")
	) {
		return "storage"
	}

	// Proxies
	if (
		name.includes("nginx") ||
		name.includes("traefik") ||
		name.includes("haproxy") ||
		name.includes("envoy") ||
		name.includes("caddy")
	) {
		return "proxy"
	}

	// Default to container
	return "container"
}

/**
 * Parse port strings like "8080:80" or "8080"
 */
function parsePort(port: string | { target?: number; published?: number }): PortMapping | null {
	if (typeof port === "object") {
		if (port.target) {
			return {
				internal: port.target,
				external: port.published,
			}
		}
		return null
	}

	const str = String(port)
	// Handle formats: "8080:80", "8080:80/tcp", "8080", "127.0.0.1:8080:80"
	const parts = str.split(":").map((p) => p.split("/")[0]) // Remove protocol suffix

	if (parts.length === 1) {
		const num = Number.parseInt(parts[0] ?? "", 10)
		return Number.isNaN(num) ? null : { internal: num }
	}

	if (parts.length === 2) {
		const ext = Number.parseInt(parts[0] ?? "", 10)
		const int = Number.parseInt(parts[1] ?? "", 10)
		return Number.isNaN(ext) || Number.isNaN(int)
			? null
			: { internal: int, external: ext }
	}

	if (parts.length === 3) {
		// IP:external:internal
		const ext = Number.parseInt(parts[1] ?? "", 10)
		const int = Number.parseInt(parts[2] ?? "", 10)
		return Number.isNaN(ext) || Number.isNaN(int)
			? null
			: { internal: int, external: ext }
	}

	return null
}

/**
 * Parse volume strings like "./data:/app/data" or named volumes "db-data:/var/lib/postgresql/data"
 */
function parseVolume(
	vol: string | { source?: string; target?: string; type?: string },
): VolumeMount | null {
	if (typeof vol === "object") {
		if (vol.source && vol.target) {
			return {
				source: vol.source,
				target: vol.target,
				type: vol.type as VolumeMount["type"],
			}
		}
		return null
	}

	const str = String(vol)
	const parts = str.split(":")

	if (parts.length >= 2) {
		const source = parts[0]
		const target = parts[1]
		if (source && target) {
			const type: VolumeMount["type"] = source.startsWith("/") || source.startsWith(".")
				? "bind"
				: "volume"
			return { source, target, type }
		}
	}

	return null
}

/**
 * Convert environment array to record
 */
function parseEnvironment(
	env?: Record<string, string> | string[],
): Record<string, string> | undefined {
	if (!env) return undefined

	if (Array.isArray(env)) {
		const record: Record<string, string> = {}
		for (const item of env) {
			const idx = item.indexOf("=")
			if (idx > 0) {
				const key = item.slice(0, idx)
				const value = item.slice(idx + 1)
				record[key] = value
			}
		}
		return Object.keys(record).length > 0 ? record : undefined
	}

	return Object.keys(env).length > 0 ? env : undefined
}

/**
 * Parse a docker-compose.yml file into an InfraGraph
 */
export function parseDockerCompose(
	content: string,
	filename: string,
	project: string,
): InfraGraph {
	const compose = parseYaml(content, yamlParseOptions) as DockerComposeFile

	if (!compose?.services) {
		return {
			nodes: [],
			edges: [],
			metadata: {
				project,
				parsedAt: new Date().toISOString(),
				sourceFiles: [filename],
				parserVersion: "0.1.0",
			},
		}
	}

	const builder = new GraphBuilder(project)
	builder.addSourceFile(filename)

	// First pass: add all services as nodes
	for (const [serviceName, service] of Object.entries(compose.services)) {
		const image = service.image ?? (typeof service.build === "string" ? `build:${service.build}` : undefined)
		const type = inferServiceType(serviceName, image)

		const ports = service.ports
			?.map(parsePort)
			.filter((p): p is PortMapping => p !== null)

		const volumes = service.volumes
			?.map(parseVolume)
			.filter((v): v is VolumeMount => v !== null)

		const environment = parseEnvironment(service.environment)

		builder.addNode(
			serviceName,
			serviceName,
			type,
			{ file: filename, format: "docker-compose" },
			{
				image,
				ports: ports?.length ? ports : undefined,
				volumes: volumes?.length ? volumes : undefined,
				environment,
				replicas: service.deploy?.replicas,
			},
		)
	}

	// Second pass: add edges for dependencies
	for (const [serviceName, service] of Object.entries(compose.services)) {
		// depends_on
		if (service.depends_on) {
			const deps = Array.isArray(service.depends_on)
				? service.depends_on
				: Object.keys(service.depends_on)
			for (const dep of deps) {
				builder.addEdge(serviceName, dep, "depends_on")
			}
		}

		// links (legacy)
		if (service.links) {
			for (const link of service.links) {
				// Links can be "service" or "service:alias"
				const target = link.split(":")[0]
				if (target) {
					builder.addEdge(serviceName, target, "link")
				}
			}
		}

		// Infer dependencies from environment variables
		// Look for patterns like SERVICE_HOST, SERVICE_URL, etc.
		if (service.environment) {
			const envVars = Array.isArray(service.environment)
				? service.environment
				: Object.entries(service.environment).map(([k, v]) => `${k}=${v}`)

			for (const envVar of envVars) {
				// Check for references to other services
				for (const otherService of Object.keys(compose.services)) {
					if (otherService === serviceName) continue

					// Check if the env var references this service
					const envLower = envVar.toLowerCase()
					const servicePattern = otherService.toLowerCase().replace(/-/g, "_")
					if (
						envLower.includes(`${servicePattern}_host`) ||
						envLower.includes(`${servicePattern}_url`) ||
						envLower.includes(`${servicePattern}:`) ||
						envVar.includes(`://${otherService}:`) ||
						envVar.includes(`://${otherService}/`)
					) {
						builder.addEdge(serviceName, otherService, "inferred")
					}
				}
			}
		}
	}

	return builder.build()
}
