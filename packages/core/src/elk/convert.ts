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
	ui: 1, // Web frontends, UI services
	api: 2, // API services, gateways, streaming
	worker: 3, // Background job processors (sidekiq, celery)
	queue: 4, // Message queues, brokers
	data: 5, // Databases, caches, storage
}

/**
 * Default node dimensions
 */
const DEFAULT_NODE_SIZE = { width: 140, height: 50 }

/**
 * Node dimensions based on service type
 */
const NODE_SIZES: Record<string, { width: number; height: number }> = {
	database: { width: 160, height: 80 },
	cache: { width: 140, height: 70 },
	storage: { width: 160, height: 80 },
	queue: { width: 120, height: 60 },
	proxy: { width: 100, height: 50 },
}

function parseCpuCores(value?: string): number | undefined {
	if (!value) return undefined
	if (value.endsWith("m")) {
		const milli = Number.parseFloat(value.slice(0, -1))
		return Number.isFinite(milli) ? milli / 1000 : undefined
	}
	const cores = Number.parseFloat(value)
	return Number.isFinite(cores) ? cores : undefined
}

function parseMemoryMi(value?: string): number | undefined {
	if (!value) return undefined
	const match = value.match(/^(\d+(?:\.\d+)?)([a-zA-Z]+)?$/)
	if (!match) return undefined

	const amount = Number.parseFloat(match[1] ?? "")
	if (!Number.isFinite(amount)) return undefined

	const unit = (match[2] ?? "").toLowerCase()
	switch (unit) {
		case "ki":
			return amount / 1024
		case "mi":
			return amount
		case "gi":
			return amount * 1024
		case "ti":
			return amount * 1024 * 1024
		case "k":
			return amount / 1024
		case "m":
			return amount
		case "g":
			return amount * 1024
		default:
			return amount
	}
}

function getResourceScale(node: ServiceNode): number {
	const cpu = parseCpuCores(node.resourceRequests?.cpu)
	const memory = parseMemoryMi(node.resourceRequests?.memory)

	if (cpu === undefined && memory === undefined) return 1

	if ((cpu ?? 0) >= 2 || (memory ?? 0) >= 2048) return 1.4
	if ((cpu ?? 0) >= 1 || (memory ?? 0) >= 1024) return 1.25
	if ((cpu ?? 0) >= 0.5 || (memory ?? 0) >= 512) return 1.1
	return 1
}

/**
 * Determine the semantic layer for a service based on its type and category
 */
export function getSemanticLayer(node: ServiceNode): SemanticLayer {
	const nameLower = node.name.toLowerCase()

	// Standalone dashboards are entry points (check before type-based rules)
	// These are directly user-accessible UIs, not behind a proxy
	if (
		nameLower.endsWith("-ui") ||
		nameLower === "grafana" ||
		nameLower === "kibana" ||
		nameLower === "prometheus"
	) {
		return "entry"
	}

	// Type-based rules
	switch (node.type) {
		case "proxy":
			return "entry"
		case "ui":
			return "ui"
		case "database":
		case "storage":
			return "data"
		case "cache":
			return "data"
		case "queue":
			return "queue"
	}

	// Name-based heuristics for common patterns

	// Entry points (proxies, load balancers)
	if (
		nameLower.includes("nginx") ||
		nameLower.includes("haproxy") ||
		nameLower.includes("traefik") ||
		nameLower.includes("ingress") ||
		nameLower.includes("caddy") ||
		nameLower.includes("proxy")
	) {
		return "entry"
	}

	// UI layer (frontends served behind a proxy)
	if (
		nameLower.includes("frontend") ||
		nameLower.includes("client") ||
		nameLower.includes("app")
	) {
		return "ui"
	}

	// Worker layer (background job processors)
	if (
		nameLower.includes("sidekiq") ||
		nameLower.includes("celery") ||
		nameLower.includes("resque") ||
		nameLower.includes("worker") ||
		nameLower.includes("job") ||
		nameLower.includes("consumer") ||
		nameLower.includes("processor")
	) {
		return "worker"
	}

	// API layer (gateways, APIs, streaming services)
	if (
		nameLower.includes("api") ||
		nameLower.includes("gateway") ||
		nameLower.includes("relay") ||
		nameLower.includes("streaming") ||
		nameLower.includes("graphql") ||
		nameLower.includes("grpc")
	) {
		return "api"
	}

	// Storage/data services
	if (
		nameLower.includes("seaweedfs") ||
		nameLower.includes("objectstorage") ||
		nameLower.includes("minio") ||
		nameLower.includes("s3")
	) {
		return "data"
	}

	// Default to API layer (most services are API/backend services)
	return "api"
}

/**
 * Get node dimensions based on service type
 */
function getNodeSize(node: ServiceNode): { width: number; height: number } {
	const base = NODE_SIZES[node.type] ?? DEFAULT_NODE_SIZE
	const scale = getResourceScale(node)
	return {
		width: Math.round(base.width * scale),
		height: Math.round(base.height * scale),
	}
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

	// Track which nodes need ports for directional connections
	// Key: nodeId, Value: { east: portIds[], west: portIds[], north: portIds[], south: portIds[] }
	const nodePorts = new Map<
		string,
		{ east: string[]; west: string[]; north: string[]; south: string[] }
	>()
	const ensureNodePorts = (nodeId: string) => {
		if (!nodePorts.has(nodeId)) {
			nodePorts.set(nodeId, { east: [], west: [], north: [], south: [] })
		}
		return nodePorts.get(nodeId)!
	}

	// Assign layers to all nodes
	const layerAssignments = new Map<string, SemanticLayer>()
	for (const node of graph.nodes) {
		layerAssignments.set(node.id, getSemanticLayer(node))
	}

	// Convert edges, adding port references for directional flow
	const edges: ElkEdge[] = graph.edges.map((edge, index) => {
		const edgeId = `e${index}`

		const sourceLayer = layerAssignments.get(edge.from) ?? "api"
		const targetLayer = layerAssignments.get(edge.to) ?? "api"
		const sourcePartition = LAYER_PARTITIONS[sourceLayer]
		const targetPartition = LAYER_PARTITIONS[targetLayer]
		if (sourcePartition === targetPartition) {
			const sourcePortId = `${edge.from}-south-${index}`
			const targetPortId = `${edge.to}-north-${index}`

			ensureNodePorts(edge.from).south.push(sourcePortId)
			ensureNodePorts(edge.to).north.push(targetPortId)

			return {
				id: edgeId,
				sources: [sourcePortId],
				targets: [targetPortId],
			}
		}

		const flowsRight = sourcePartition < targetPartition
		const sourceSide = flowsRight ? "east" : "west"
		const targetSide = flowsRight ? "west" : "east"
		const sourcePortId = `${edge.from}-${sourceSide}-${index}`
		const targetPortId = `${edge.to}-${targetSide}-${index}`

		if (flowsRight) {
			ensureNodePorts(edge.from).east.push(sourcePortId)
			ensureNodePorts(edge.to).west.push(targetPortId)
		} else {
			ensureNodePorts(edge.from).west.push(sourcePortId)
			ensureNodePorts(edge.to).east.push(targetPortId)
		}

		return {
			id: edgeId,
			sources: [sourcePortId],
			targets: [targetPortId],
		}
	})

	// Convert nodes, adding ports where needed
	const children: ElkNode[] = graph.nodes.map((node) => {
		const layer = layerAssignments.get(node.id) ?? "api"
		const elkNode = convertNode(node, layer, enablePartitioning)

		// Add ports if this node has directional connections
		const ports = nodePorts.get(node.id)
		if (ports) {
			const elkPorts: ElkPort[] = []

			// Add EAST ports (outgoing)
			for (const portId of ports.east) {
				elkPorts.push({
					id: portId,
					layoutOptions: { "elk.port.side": "EAST" },
				})
			}

			// Add WEST ports (incoming)
			for (const portId of ports.west) {
				elkPorts.push({
					id: portId,
					layoutOptions: { "elk.port.side": "WEST" },
				})
			}

			// Add NORTH ports (incoming for same-lane)
			for (const portId of ports.north) {
				elkPorts.push({
					id: portId,
					layoutOptions: { "elk.port.side": "NORTH" },
				})
			}

			// Add SOUTH ports (outgoing for same-lane)
			for (const portId of ports.south) {
				elkPorts.push({
					id: portId,
					layoutOptions: { "elk.port.side": "SOUTH" },
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
		ui: [],
		api: [],
		worker: [],
		queue: [],
		data: [],
	}

	for (const [nodeId, layer] of layerAssignments) {
		summary[layer].push(nodeId)
	}

	return summary
}
