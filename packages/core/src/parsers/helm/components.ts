import type { HelmValues } from "./values"
import { getBoolean, isRecord } from "./values"

export interface HelmComponent {
	name: string
	values: HelmValues
}

const SKIP_KEYS = new Set([
	"global",
	"image",
	"service",
	"resources",
	"persistence",
	"ingress",
	"rbac",
	"serviceAccount",
	"nodeSelector",
	"tolerations",
	"affinity",
	"autoscaling",
	"metrics",
	"networkPolicy",
	"securityContext",
	"podSecurityContext",
	"volumePermissions",
	"extraEnvVars",
	"extraVolumeMounts",
	"extraVolumes",
	"fullnameOverride",
	"nameOverride",
])

function hasComponentMarkers(values: HelmValues): boolean {
	return (
		"replicaCount" in values ||
		"replicas" in values ||
		"containerPorts" in values ||
		"containerPort" in values ||
		("service" in values && isRecord(values.service)) ||
		"image" in values ||
		"resources" in values
	)
}

export function detectComponents(
	values: HelmValues,
	options?: { dependencyNames?: string[] },
): HelmComponent[] {
	const components: HelmComponent[] = []
	const dependencyNames = new Set(
		options?.dependencyNames?.map((name) => name.toLowerCase()) ?? [],
	)

	for (const [key, value] of Object.entries(values)) {
		if (!isRecord(value)) continue

		if (SKIP_KEYS.has(key)) continue
		if (dependencyNames.has(key.toLowerCase())) continue
		if (key.startsWith("external")) continue

		const enabled = getBoolean(value.enabled)
		if (enabled === false) continue

		if (!hasComponentMarkers(value)) continue

		components.push({ name: key, values: value })
	}

	return components
}
