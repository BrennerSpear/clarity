import type { ServiceType } from "../graph/types"

/**
 * Infer service type from image name or service name
 */
export function inferServiceType(
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
		name.includes("cockroach") ||
		name.includes("schema")
	) {
		return "database"
	}

	// Caches
	if (
		name.includes("redis") ||
		name.includes("memcache") ||
		name.includes("keydb") ||
		name.includes("elasticsearch") ||
		name.includes("opensearch")
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
		name.includes("seaweedfs") ||
		name.includes("seaweed") ||
		name.includes("objectstorage") ||
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

	// UI/frontends
	if (
		(name.includes("web") ||
			name.includes("frontend") ||
			name.includes("ui") ||
			name.includes("console") ||
			name.includes("dashboard") ||
			name.includes("portal")) &&
		!name.includes("grafana") &&
		!name.includes("kibana")
	) {
		return "ui"
	}

	// Default to container
	return "container"
}
