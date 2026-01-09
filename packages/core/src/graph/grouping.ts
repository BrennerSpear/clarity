/**
 * Dependency path grouping for infrastructure graphs
 *
 * Groups services that have identical dependency sets into single visual nodes
 */

import type {
	DependencyEdge,
	DependencyType,
	InfraGraph,
	ServiceNode,
	ServiceType,
} from "./types"

/**
 * Direction of data flow for an edge
 */
export type EdgeDirection = "read" | "write" | "bidirectional"

/**
 * Extended edge with direction information
 */
export interface DirectedEdge extends DependencyEdge {
	direction: EdgeDirection
}

/**
 * A group of services with identical dependencies
 */
export interface ServiceGroup {
	id: string
	name: string
	services: ServiceNode[]
	dependencySignature: string
	dependencies: string[]
}

/**
 * Graph with grouped services
 */
export interface GroupedGraph {
	/** Individual services that weren't grouped */
	nodes: ServiceNode[]
	/** Groups of services with identical dependencies */
	groups: ServiceGroup[]
	/** Edges with direction information */
	edges: DirectedEdge[]
	/** Original metadata */
	metadata: InfraGraph["metadata"]
}

/**
 * Calculate a signature for a service's dependencies
 */
function calculateDependencySignature(
	serviceId: string,
	edges: DependencyEdge[],
): { signature: string; dependencies: string[] } {
	const dependencies = edges
		.filter((e) => e.from === serviceId)
		.map((e) => e.to)
		.sort()

	return {
		signature: dependencies.join(","),
		dependencies,
	}
}

/**
 * Find the longest common prefix among strings
 */
function findLongestCommonPrefix(strings: string[]): string {
	if (strings.length === 0) return ""
	if (strings.length === 1) return strings[0] ?? ""

	const sorted = [...strings].sort()
	const first = sorted[0] ?? ""
	const last = sorted[sorted.length - 1] ?? ""

	let i = 0
	while (i < first.length && first[i] === last[i]) {
		i++
	}

	return first.substring(0, i)
}

/**
 * Find common pattern in service names (handles prefixes and suffixes)
 */
function findCommonPattern(names: string[]): string {
	if (names.length === 0) return "services"
	if (names.length === 1) return names[0] ?? "service"

	// Try to find common prefix
	const prefix = findLongestCommonPrefix(names)

	// If we have a meaningful prefix (at least 3 chars, ends reasonably)
	if (prefix.length >= 3) {
		// Clean up trailing dashes or underscores
		const cleanPrefix = prefix.replace(/[-_]+$/, "")
		if (cleanPrefix.length >= 3) {
			// Check if there's a common suffix pattern too
			const suffixes = names.map((n) => n.slice(prefix.length))
			const commonSuffix = findCommonSuffix(suffixes)

			if (commonSuffix.length >= 3) {
				return `${cleanPrefix}-*-${commonSuffix.replace(/^[-_]+/, "")}`
			}
			return `${cleanPrefix}-*`
		}
	}

	// Try to find common suffix (like "-consumer")
	const reversedNames = names.map((n) => n.split("").reverse().join(""))
	const reversedPrefix = findLongestCommonPrefix(reversedNames)
	const suffix = reversedPrefix.split("").reverse().join("")

	if (suffix.length >= 3) {
		const cleanSuffix = suffix.replace(/^[-_]+/, "")
		if (cleanSuffix.length >= 3) {
			return `*-${cleanSuffix}`
		}
	}

	// Fall back to describing what they are
	return "grouped services"
}

/**
 * Find common suffix among strings
 */
function findCommonSuffix(strings: string[]): string {
	const reversed = strings.map((s) => s.split("").reverse().join(""))
	const prefix = findLongestCommonPrefix(reversed)
	return prefix.split("").reverse().join("")
}

/**
 * Generate a descriptive name for a group based on dependencies
 */
function generateGroupName(
	services: ServiceNode[],
	dependencies: string[],
	allNodes: ServiceNode[],
): string {
	const names = services.map((s) => s.name)
	const pattern = findCommonPattern(names)

	// Get types of dependencies for context
	const depNodes = allNodes.filter((n) => dependencies.includes(n.id))
	const depTypes = [...new Set(depNodes.map((n) => n.type))].sort()

	if (pattern !== "grouped services") {
		return `${pattern} (${services.length})`
	}

	// Describe by what they connect to
	const typeLabels = depTypes
		.map((t) => {
			switch (t) {
				case "queue":
					return "queue"
				case "database":
					return "db"
				case "cache":
					return "cache"
				default:
					return t
			}
		})
		.join("/")

	if (typeLabels) {
		return `${typeLabels} clients (${services.length})`
	}

	return `grouped services (${services.length})`
}

/**
 * Check if a service name indicates a consumer pattern
 */
function isConsumerService(name: string): boolean {
	const lower = name.toLowerCase()
	return lower.includes("consumer") || lower.includes("subscriber")
}

/**
 * Check if a service name indicates a producer pattern
 */
function isProducerService(name: string): boolean {
	const lower = name.toLowerCase()
	return (
		lower.includes("producer") ||
		lower.includes("publisher") ||
		lower.includes("writer")
	)
}

/**
 * Check if a service name indicates a worker pattern
 */
function isWorkerService(name: string): boolean {
	const lower = name.toLowerCase()
	return lower.includes("worker") || lower.includes("processor")
}

/**
 * Infer edge direction based on service characteristics
 */
export function inferEdgeDirection(
	fromService: ServiceNode,
	toService: ServiceNode,
	edge: DependencyEdge,
): EdgeDirection {
	const fromName = fromService.name.toLowerCase()
	const toType = toService.type

	const isConsumer = isConsumerService(fromName)
	const isProducer = isProducerService(fromName)
	const isWorker = isWorkerService(fromName)

	// Determine direction based on source service role and target type
	if (isConsumer) {
		// Consumers read from queues, write to databases/caches
		if (toType === "queue") return "read"
		if (toType === "database" || toType === "cache") return "write"
		return "bidirectional"
	}

	if (isProducer) {
		// Producers write to queues
		if (toType === "queue") return "write"
		return "bidirectional"
	}

	if (isWorker) {
		// Workers typically read from queues, read/write databases
		if (toType === "queue") return "read"
		return "bidirectional"
	}

	// Default inference based on target type for generic services
	if (toType === "database") {
		// Most services both read and write to databases
		return "bidirectional"
	}

	if (toType === "cache") {
		// Caches are typically read/write
		return "bidirectional"
	}

	if (toType === "queue") {
		// Default to write for queues (producing messages)
		return "write"
	}

	return "bidirectional"
}

/**
 * Infer edge direction for a group based on its services
 */
export function inferGroupEdgeDirection(
	group: ServiceGroup,
	toService: ServiceNode,
): EdgeDirection {
	// Check if majority of services are consumers/producers/workers
	let consumerCount = 0
	let producerCount = 0
	let workerCount = 0

	for (const service of group.services) {
		if (isConsumerService(service.name)) consumerCount++
		if (isProducerService(service.name)) producerCount++
		if (isWorkerService(service.name)) workerCount++
	}

	const total = group.services.length
	const toType = toService.type

	// If majority are consumers
	if (consumerCount > total / 2) {
		if (toType === "queue") return "read"
		if (toType === "database" || toType === "cache") return "write"
		return "bidirectional"
	}

	// If majority are producers
	if (producerCount > total / 2) {
		if (toType === "queue") return "write"
		return "bidirectional"
	}

	// If majority are workers
	if (workerCount > total / 2) {
		if (toType === "queue") return "read"
		return "bidirectional"
	}

	// Default inference
	if (toType === "queue") return "write"
	if (toType === "database" || toType === "cache") return "bidirectional"

	return "bidirectional"
}

/**
 * Group services by their dependency signature
 */
export function groupByDependencyPath(
	graph: InfraGraph,
	options?: {
		/** Minimum group size to create a group (default: 2) */
		minGroupSize?: number
		/** Don't group these service types */
		excludeTypes?: ServiceType[]
		/** Don't group services that have incoming edges (default: true) */
		excludeWithIncomingEdges?: boolean
	},
): GroupedGraph {
	const { minGroupSize = 2, excludeTypes = [], excludeWithIncomingEdges = true } = options ?? {}

	// Find services that have incoming edges (other services depend on them)
	const hasIncomingEdge = new Set<string>()
	if (excludeWithIncomingEdges) {
		for (const edge of graph.edges) {
			hasIncomingEdge.add(edge.to)
		}
	}

	// Calculate signatures for all services
	const signatures = new Map<
		string,
		{ signature: string; dependencies: string[] }
	>()
	for (const node of graph.nodes) {
		signatures.set(node.id, calculateDependencySignature(node.id, graph.edges))
	}

	// Group services by signature
	const signatureGroups = new Map<string, ServiceNode[]>()
	for (const node of graph.nodes) {
		// Skip excluded types
		if (excludeTypes.includes(node.type)) continue

		// Skip services that have incoming edges (they're important targets)
		if (hasIncomingEdge.has(node.id)) continue

		const sig = signatures.get(node.id)
		if (!sig || sig.signature === "") continue // Skip services with no dependencies

		if (!signatureGroups.has(sig.signature)) {
			signatureGroups.set(sig.signature, [])
		}
		signatureGroups.get(sig.signature)?.push(node)
	}

	// Separate into groups (meeting size threshold) and individuals
	const groups: ServiceGroup[] = []
	const individualNodes: ServiceNode[] = []
	const groupedServiceIds = new Set<string>()

	for (const [signature, services] of signatureGroups) {
		if (services.length >= minGroupSize) {
			const deps = signatures.get(services[0]?.id ?? "")?.dependencies ?? []
			const group: ServiceGroup = {
				id: `group-${groups.length}`,
				name: generateGroupName(services, deps, graph.nodes),
				services,
				dependencySignature: signature,
				dependencies: deps,
			}
			groups.push(group)
			for (const s of services) {
				groupedServiceIds.add(s.id)
			}
		} else {
			individualNodes.push(...services)
		}
	}

	// Add services that had no dependencies or were excluded
	for (const node of graph.nodes) {
		if (!groupedServiceIds.has(node.id) && !individualNodes.includes(node)) {
			individualNodes.push(node)
		}
	}

	// Create directed edges
	const directedEdges: DirectedEdge[] = []
	const processedEdges = new Set<string>()

	// Add edges from groups
	for (const group of groups) {
		for (const depId of group.dependencies) {
			const edgeKey = `${group.id}->${depId}`
			if (processedEdges.has(edgeKey)) continue
			processedEdges.add(edgeKey)

			// Find the target node
			const targetNode = graph.nodes.find((n) => n.id === depId)
			if (!targetNode) continue

			const sampleService = group.services[0]
			const originalEdge = sampleService
				? graph.edges.find(
						(e) => e.from === sampleService.id && e.to === depId,
					)
				: undefined

			// Use group-aware direction inference
			directedEdges.push({
				from: group.id,
				to: depId,
				type: originalEdge?.type ?? "depends_on",
				port: originalEdge?.port,
				protocol: originalEdge?.protocol,
				direction: inferGroupEdgeDirection(group, targetNode),
			})
		}
	}

	// Add edges from individual nodes
	for (const node of individualNodes) {
		const nodeEdges = graph.edges.filter((e) => e.from === node.id)
		for (const edge of nodeEdges) {
			// Skip if target is in a group (edge will come from group)
			if (groupedServiceIds.has(edge.to)) continue

			const edgeKey = `${edge.from}->${edge.to}`
			if (processedEdges.has(edgeKey)) continue
			processedEdges.add(edgeKey)

			const targetNode = graph.nodes.find((n) => n.id === edge.to)
			if (!targetNode) continue

			directedEdges.push({
				...edge,
				direction: inferEdgeDirection(node, targetNode, edge),
			})
		}
	}

	// Add edges between individual nodes and groups' dependencies
	// (for nodes that depend on the same things groups depend on)
	for (const node of individualNodes) {
		const nodeEdges = graph.edges.filter((e) => e.from === node.id)
		for (const edge of nodeEdges) {
			const edgeKey = `${edge.from}->${edge.to}`
			if (processedEdges.has(edgeKey)) continue
			processedEdges.add(edgeKey)

			const targetNode = graph.nodes.find((n) => n.id === edge.to)
			if (!targetNode) continue

			directedEdges.push({
				...edge,
				direction: inferEdgeDirection(node, targetNode, edge),
			})
		}
	}

	return {
		nodes: individualNodes,
		groups,
		edges: directedEdges,
		metadata: graph.metadata,
	}
}

/**
 * Get color for edge direction
 */
export function getEdgeDirectionColor(direction: EdgeDirection): string {
	switch (direction) {
		case "read":
			return "#228be6" // Blue
		case "write":
			return "#f76707" // Orange
		case "bidirectional":
			return "#868e96" // Gray
	}
}
