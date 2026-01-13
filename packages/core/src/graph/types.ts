export type ServiceType =
	| "container"
	| "database"
	| "cache"
	| "queue"
	| "storage"
	| "proxy"
	| "ui"

export type QueueRole = "producer" | "consumer" | "both"

export type DependencyType =
	| "depends_on"
	| "network"
	| "volume"
	| "link"
	| "inferred"

export type SourceFormat = "docker-compose" | "helm" | "terraform" | "ansible"

export interface PortMapping {
	internal: number
	external?: number
}

export interface VolumeMount {
	source: string
	target: string
	type?: "volume" | "bind" | "tmpfs"
}

export interface SourceInfo {
	file: string
	format: SourceFormat
	line?: number
}

export interface ServiceNode {
	id: string
	name: string
	type: ServiceType
	source: SourceInfo

	// Parsed from IaC
	image?: string
	ports?: PortMapping[]
	volumes?: VolumeMount[]
	environment?: Record<string, string | number | boolean | null>
	replicas?: number

	// LLM-enhanced (Phase 3)
	description?: string
	group?: string
	queueRole?: QueueRole
}

export interface DependencyEdge {
	from: string
	to: string
	type: DependencyType
	port?: number
	protocol?: string
}

export interface GraphMetadata {
	project: string
	parsedAt: string
	sourceFiles: string[]
	parserVersion: string
}

export interface InfraGraph {
	nodes: ServiceNode[]
	edges: DependencyEdge[]
	metadata: GraphMetadata
}
