/**
 * Convert InfraGraph to ELK graph format with semantic layering
 */

import type { InfraGraph, ServiceNode } from "../graph/types"
import type { ElkPort } from "./types"
import {
	ELK_LAYOUT_OPTIONS,
	type ElkConversionResult,
	type ElkEdge,
	type ElkGraph,
	type ElkNode,
	type SemanticLayer,
} from "./types"

/**
 * Semantic layer partitions (left to right)
 */
const LAYER_PARTITIONS: Record<SemanticLayer, number> = {
	entry: 0, // Proxies, load balancers, external-facing
	gateway: 1, // API gateways, relay services
	application: 2, // Application services, workers, consumers
	queue: 3, // Message queues, brokers
	data: 4, // Databases, caches, storage
}

/**
 * Default node dimensions
 */
const DEFAULT_NODE_SIZE = { width: 140, height: 50 }

/**
 * Node dimensions based on service type
 */
const NODE_SIZES: Record<string, { width: number; height: number }> = {
	database: { width: 120, height: 60 },
	cache: { width: 100, height: 50 },
	queue: { width: 100, height: 50 },
	proxy: { width: 100, height: 50 },
}

/**
 * Determine the semantic layer for a service based on its type and category
 */
export function getSemanticLayer(node: ServiceNode): SemanticLayer {
	// Type-based rules (highest priority)
	switch (node.type) {
		case "proxy":
			return "entry"
		case "database":
		case "storage":
			return "data"
		case "cache":
			return "data"
		case "queue":
			return "queue"
	}

	// Name-based heuristics for common patterns
	const nameLower = node.name.toLowerCase()

	// Entry points
	if (
		nameLower.includes("nginx") ||
		nameLower.includes("haproxy") ||
		nameLower.includes("traefik") ||
		nameLower.includes("ingress")
	) {
		return "entry"
	}

	// Gateway/relay services
	if (nameLower.includes("relay") || nameLower.includes("gateway")) {
		return "gateway"
	}

	// Default to application layer
	return "application"
}

/**
 * Get node dimensions based on service type
 */
function getNodeSize(node: ServiceNode): { width: number; height: number } {
	return NODE_SIZES[node.type] ?? DEFAULT_NODE_SIZE
}

/**
 * Estimate label dimensions based on text length
 */
function getLabelDimensions(text: string): { width: number; height: number } {
	// Approximate: 8px per character, 20px height
	return {
		width: Math.max(40, text.length * 8),
		height: 20,
	}
}

/**
 * Convert a ServiceNode to an ElkNode
 */
function convertNode(
	node: ServiceNode,
	layer: SemanticLayer,
	enablePartitioning: boolean,
): ElkNode {
	const size = getNodeSize(node)
	const labelDims = getLabelDimensions(node.name)

	const elkNode: ElkNode = {
		id: node.id,
		width: Math.max(size.width, labelDims.width + 20),
		height: size.height,
		labels: [
			{
				text: node.name,
				width: labelDims.width,
				height: labelDims.height,
			},
		],
	}

	// Add partition constraint if semantic layering is enabled
	if (enablePartitioning) {
		elkNode.layoutOptions = {
			"elk.partitioning.partition": String(LAYER_PARTITIONS[layer]),
		}
	}

	return elkNode
}

export interface ConvertOptions {
	/** Enable semantic partitioning (default: true) */
	semanticLayers?: boolean
}

/**
 * Convert an InfraGraph to ELK graph format
 */
export function infraGraphToElk(
	graph: InfraGraph,
	options: ConvertOptions = {},
): ElkConversionResult {
	const enablePartitioning = options.semanticLayers !== false

	// Build node type map for quick lookup
	const nodeTypeMap = new Map<string, string>()
	for (const node of graph.nodes) {
		nodeTypeMap.set(node.id, node.type)
	}

	// Identify cache nodes
	const cacheNodes = new Set<string>()
	for (const node of graph.nodes) {
		if (node.type === "cache") {
			cacheNodes.add(node.id)
		}
	}

	// Track which nodes need ports for cache connections
	// Key: nodeId, Value: { south: portIds[], north: portIds[] }
	const nodePorts = new Map<string, { south: string[]; north: string[] }>()

	// Assign layers to all nodes
	const layerAssignments = new Map<string, SemanticLayer>()
	for (const node of graph.nodes) {
		layerAssignments.set(node.id, getSemanticLayer(node))
	}

	// Convert edges, adding port references for cache connections
	const edges: ElkEdge[] = graph.edges.map((edge, index) => {
		const edgeId = `e${index}`
		const targetIsCache = cacheNodes.has(edge.to)

		if (targetIsCache) {
			// Source needs a SOUTH port, target (cache) needs a NORTH port
			const sourcePortId = `${edge.from}-south-${index}`
			const targetPortId = `${edge.to}-north-${index}`

			// Track ports for each node
			if (!nodePorts.has(edge.from)) {
				nodePorts.set(edge.from, { south: [], north: [] })
			}
			nodePorts.get(edge.from)!.south.push(sourcePortId)

			if (!nodePorts.has(edge.to)) {
				nodePorts.set(edge.to, { south: [], north: [] })
			}
			nodePorts.get(edge.to)!.north.push(targetPortId)

			return {
				id: edgeId,
				sources: [sourcePortId],
				targets: [targetPortId],
			}
		}

		// Regular edge (no port constraints)
		return {
			id: edgeId,
			sources: [edge.from],
			targets: [edge.to],
		}
	})

	// Convert nodes, adding ports where needed
	const children: ElkNode[] = graph.nodes.map((node) => {
		const layer = layerAssignments.get(node.id) ?? "application"
		const elkNode = convertNode(node, layer, enablePartitioning)

		// Add ports if this node has cache connections
		const ports = nodePorts.get(node.id)
		if (ports) {
			const elkPorts: ElkPort[] = []

			// Add SOUTH ports (for outgoing edges to caches)
			for (const portId of ports.south) {
				elkPorts.push({
					id: portId,
					layoutOptions: { "elk.port.side": "SOUTH" },
				})
			}

			// Add NORTH ports (for incoming edges from containers)
			for (const portId of ports.north) {
				elkPorts.push({
					id: portId,
					layoutOptions: { "elk.port.side": "NORTH" },
				})
			}

			if (elkPorts.length > 0) {
				elkNode.ports = elkPorts
				elkNode.layoutOptions = {
					...elkNode.layoutOptions,
					"elk.portConstraints": "FIXED_SIDE",
				}
			}
		}

		return elkNode
	})

	// Build the root graph
	const layoutOptions = enablePartitioning
		? ELK_LAYOUT_OPTIONS.semantic
		: ELK_LAYOUT_OPTIONS.standard

	const elkGraph: ElkGraph = {
		id: "root",
		layoutOptions: { ...layoutOptions },
		children,
		edges,
	}

	return {
		graph: elkGraph,
		layerAssignments,
	}
}

/**
 * Debug utility: summarize layer assignments
 */
export function summarizeLayers(
	layerAssignments: Map<string, SemanticLayer>,
): Record<SemanticLayer, string[]> {
	const summary: Record<SemanticLayer, string[]> = {
		entry: [],
		gateway: [],
		application: [],
		queue: [],
		data: [],
	}

	for (const [nodeId, layer] of layerAssignments) {
		summary[layer].push(nodeId)
	}

	return summary
}
