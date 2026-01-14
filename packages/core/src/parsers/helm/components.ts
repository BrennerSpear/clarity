import type { HelmValues } from "./values"

/**
 * Known component patterns in Helm charts
 * These are top-level keys that indicate separate deployable components
 */
const COMPONENT_INDICATORS = [
	"replicaCount",
	"containerPorts",
	"resources",
	"autoscaling",
	"nodeSelector",
	"tolerations",
	"affinity",
	"podAnnotations",
	"podSecurityContext",
	"securityContext",
	"serviceAccount",
]

/**
 * Common component names in multi-component charts
 */
const KNOWN_COMPONENT_NAMES = new Set([
	// Web/API components
	"web",
	"api",
	"frontend",
	"backend",
	"server",
	"gateway",
	"nginx",
	"proxy",

	// Worker components
	"worker",
	"workers",
	"scheduler",
	"sidekiq",
	"celery",
	"beat",

	// Streaming/async components
	"streaming",
	"stream",
	"consumer",
	"producer",

	// Admin/monitoring
	"admin",
	"dashboard",
	"flower",

	// Specific apps
	"gitaly",
	"gitlab-shell",
	"kas",
	"webservice",
	"registry",
	"toolbox",
	"migrations",
	"elasticsearch",
	"postgresql",
	"redis",
	"memcached",
	"minio",
])

/**
 * Detected component in a Helm chart
 */
export interface HelmComponent {
	name: string
	path: string // Path in values.yaml (e.g., "worker" or "components.worker")
	hasReplicas: boolean
	hasPorts: boolean
	hasResources: boolean
}

/**
 * Detect multi-component structure in values.yaml
 * Returns array of component paths that represent separate deployable units
 */
export function detectComponents(values: HelmValues): HelmComponent[] {
	const components: HelmComponent[] = []

	// Check top-level keys for component patterns
	for (const [key, value] of Object.entries(values)) {
		// Skip known non-component keys
		if (isKnownNonComponent(key)) {
			continue
		}

		// Check if this looks like a component
		if (typeof value === "object" && value !== null) {
			const section = value as Record<string, unknown>

			const hasComponentIndicators = COMPONENT_INDICATORS.some(
				(indicator) => indicator in section,
			)

			const isKnownComponent = KNOWN_COMPONENT_NAMES.has(key.toLowerCase())

			if (hasComponentIndicators || isKnownComponent) {
				components.push({
					name: key,
					path: key,
					hasReplicas: "replicaCount" in section,
					hasPorts:
						"containerPorts" in section ||
						("service" in section &&
							typeof section.service === "object" &&
							section.service !== null &&
							("port" in section.service || "ports" in section.service)),
					hasResources: "resources" in section,
				})
			}
		}
	}

	return components
}

/**
 * Known keys that are NOT components
 */
function isKnownNonComponent(key: string): boolean {
	const nonComponentKeys = new Set([
		// Common config keys
		"global",
		"nameOverride",
		"fullnameOverride",
		"commonLabels",
		"commonAnnotations",
		"kubeVersion",
		"clusterDomain",

		// Top-level config
		"image",
		"imagePullSecrets",
		"replicaCount",
		"updateStrategy",
		"podAnnotations",
		"podLabels",
		"podSecurityContext",
		"securityContext",
		"service",
		"ingress",
		"resources",
		"autoscaling",
		"nodeSelector",
		"tolerations",
		"affinity",
		"priorityClassName",
		"schedulerName",
		"topologySpreadConstraints",
		"terminationGracePeriodSeconds",

		// Storage
		"persistence",
		"volumePermissions",
		"extraVolumes",
		"extraVolumeMounts",

		// Config
		"configuration",
		"existingConfigmap",
		"existingSecret",
		"extraEnvVars",
		"extraEnvVarsCM",
		"extraEnvVarsSecret",
		"command",
		"args",

		// Probes
		"livenessProbe",
		"readinessProbe",
		"startupProbe",
		"customLivenessProbe",
		"customReadinessProbe",
		"customStartupProbe",

		// ServiceAccount
		"serviceAccount",
		"rbac",
		"pdb",

		// Metrics
		"metrics",
		"serviceMonitor",
		"prometheusRule",

		// Init containers
		"initContainers",
		"sidecars",

		// Networking
		"networkPolicy",
		"containerPorts",

		// External services
		"externalDatabase",
		"externalRedis",
		"externalCache",

		// TLS/Auth
		"tls",
		"auth",

		// Diagnostics
		"diagnosticMode",

		// Dependencies (these are handled separately)
		"postgresql",
		"redis",
		"mysql",
		"mariadb",
		"mongodb",
		"elasticsearch",
		"kafka",
		"rabbitmq",
		"memcached",
		"minio",
		"cassandra",
		"zookeeper",
	])

	return nonComponentKeys.has(key)
}

/**
 * Infer relationships between components
 * Returns array of [from, to] tuples
 */
export function inferComponentRelationships(
	components: HelmComponent[],
	values: HelmValues,
): [string, string][] {
	const relationships: [string, string][] = []

	// Common patterns:
	// - Workers connect to shared data stores (handled by dependency edges)
	// - Web components may connect to workers for async tasks
	// - All components typically share database/cache dependencies

	// Look for explicit references in component configs
	for (const component of components) {
		const section = values[component.path] as Record<string, unknown> | undefined
		if (!section) continue

		// Check for references to other components in environment variables
		const envVars = section.extraEnvVars as { name: string; value: string }[] | undefined
		if (envVars) {
			for (const env of envVars) {
				for (const other of components) {
					if (other.name === component.name) continue
					const value = String(env.value ?? "").toLowerCase()
					if (value.includes(other.name.toLowerCase())) {
						relationships.push([component.name, other.name])
					}
				}
			}
		}
	}

	return relationships
}
