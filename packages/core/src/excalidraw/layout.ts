/**
 * Auto-layout algorithm for infrastructure graphs
 * Uses a simple layered approach based on dependency depth
 */

import type { DependencyEdge, InfraGraph, ServiceNode } from "../graph/types"
import { LAYOUT_CONFIG } from "./types"

export interface NodePosition {
	id: string
	x: number
	y: number
	width: number
	height: number
	layer: number
}

export interface LayoutResult {
	positions: Map<string, NodePosition>
	width: number
	height: number
}

/**
 * Calculate the layer (depth) of each node based on dependencies
 * Nodes with no dependencies are at layer 0
 * Nodes that depend on layer N nodes are at layer N+1
 */
function calculateLayers(graph: InfraGraph): Map<string, number> {
	const layers = new Map<string, number>()
	const nodeIds = new Set(graph.nodes.map((n) => n.id))

	// Build dependency graph (who depends on whom)
	const dependsOn = new Map<string, Set<string>>()
	for (const node of graph.nodes) {
		dependsOn.set(node.id, new Set())
	}

	for (const edge of graph.edges) {
		// edge.from depends on edge.to
		if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
			dependsOn.get(edge.from)?.add(edge.to)
		}
	}

	// Calculate layers using topological sort approach
	// Start with nodes that have no dependencies
	const remaining = new Set(nodeIds)
	let currentLayer = 0

	while (remaining.size > 0) {
		const nodesInLayer: string[] = []

		for (const nodeId of remaining) {
			const deps = dependsOn.get(nodeId) ?? new Set()
			// Node belongs to this layer if all its dependencies are already assigned
			const allDepsAssigned = [...deps].every(
				(dep) => layers.has(dep) && !remaining.has(dep),
			)

			if (deps.size === 0 || allDepsAssigned) {
				nodesInLayer.push(nodeId)
			}
		}

		// If no nodes can be placed (cycle detected), force place remaining
		if (nodesInLayer.length === 0) {
			// Place all remaining nodes in current layer to break cycle
			for (const nodeId of remaining) {
				layers.set(nodeId, currentLayer)
			}
			break
		}

		for (const nodeId of nodesInLayer) {
			layers.set(nodeId, currentLayer)
			remaining.delete(nodeId)
		}

		currentLayer++
	}

	return layers
}

/**
 * Group nodes by their assigned layer
 */
function groupByLayer(
	nodes: ServiceNode[],
	layers: Map<string, number>,
): Map<number, ServiceNode[]> {
	const groups = new Map<number, ServiceNode[]>()

	for (const node of nodes) {
		const layer = layers.get(node.id) ?? 0
		if (!groups.has(layer)) {
			groups.set(layer, [])
		}
		groups.get(layer)?.push(node)
	}

	return groups
}

/**
 * Sort nodes within a layer to minimize edge crossings
 * Uses a simple heuristic: sort by average position of connected nodes in adjacent layers
 */
function sortNodesInLayer(
	nodes: ServiceNode[],
	layer: number,
	layerGroups: Map<number, ServiceNode[]>,
	positions: Map<string, NodePosition>,
	edges: DependencyEdge[],
): ServiceNode[] {
	if (nodes.length <= 1) return nodes

	// Get connected nodes in previous layer
	const prevLayer = layerGroups.get(layer - 1) ?? []
	const prevLayerIds = new Set(prevLayer.map((n) => n.id))

	// Calculate average position of connected nodes for each node
	const avgPositions = new Map<string, number>()

	for (const node of nodes) {
		let sum = 0
		let count = 0

		for (const edge of edges) {
			let connectedId: string | null = null
			if (edge.from === node.id && prevLayerIds.has(edge.to)) {
				connectedId = edge.to
			} else if (edge.to === node.id && prevLayerIds.has(edge.from)) {
				connectedId = edge.from
			}

			if (connectedId) {
				const pos = positions.get(connectedId)
				if (pos) {
					sum += pos.x
					count++
				}
			}
		}

		avgPositions.set(node.id, count > 0 ? sum / count : 0)
	}

	// Sort by average position
	return [...nodes].sort((a, b) => {
		return (avgPositions.get(a.id) ?? 0) - (avgPositions.get(b.id) ?? 0)
	})
}

/**
 * Calculate layout for an infrastructure graph
 */
export function calculateLayout(
	graph: InfraGraph,
	options?: {
		nodeWidth?: number
		nodeHeight?: number
		horizontalGap?: number
		verticalGap?: number
	},
): LayoutResult {
	const {
		nodeWidth = LAYOUT_CONFIG.nodeWidth,
		nodeHeight = LAYOUT_CONFIG.nodeHeight,
		horizontalGap = LAYOUT_CONFIG.horizontalGap,
		verticalGap = LAYOUT_CONFIG.verticalGap,
	} = options ?? {}

	const positions = new Map<string, NodePosition>()

	if (graph.nodes.length === 0) {
		return { positions, width: 0, height: 0 }
	}

	// Calculate layers
	const layers = calculateLayers(graph)
	const layerGroups = groupByLayer(graph.nodes, layers)

	// Find max layer
	const maxLayer = Math.max(...layers.values())

	// Calculate positions layer by layer (bottom to top, with dependencies at bottom)
	let maxWidth = 0

	for (let layer = 0; layer <= maxLayer; layer++) {
		let nodes = layerGroups.get(layer) ?? []

		// Sort nodes to minimize crossings (if previous layers are positioned)
		if (layer > 0) {
			nodes = sortNodesInLayer(
				nodes,
				layer,
				layerGroups,
				positions,
				graph.edges,
			)
		}

		// Calculate Y position for this layer (invert so dependencies are at top)
		const y = (maxLayer - layer) * (nodeHeight + verticalGap)

		// Calculate total width of this layer
		const layerWidth =
			nodes.length * nodeWidth + (nodes.length - 1) * horizontalGap

		// Center the layer
		const startX = 0

		// Position each node in the layer
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i]
			if (!node) continue

			const x = startX + i * (nodeWidth + horizontalGap)

			positions.set(node.id, {
				id: node.id,
				x,
				y,
				width: nodeWidth,
				height: nodeHeight,
				layer,
			})
		}

		maxWidth = Math.max(maxWidth, layerWidth)
	}

	// Center all layers horizontally
	for (let layer = 0; layer <= maxLayer; layer++) {
		const nodes = layerGroups.get(layer) ?? []
		const layerWidth =
			nodes.length * nodeWidth + (nodes.length - 1) * horizontalGap
		const offset = (maxWidth - layerWidth) / 2

		for (const node of nodes) {
			const pos = positions.get(node.id)
			if (pos) {
				pos.x += offset
			}
		}
	}

	const height = (maxLayer + 1) * (nodeHeight + verticalGap) - verticalGap

	return { positions, width: maxWidth, height }
}

/**
 * Get the center point of a node
 */
export function getNodeCenter(pos: NodePosition): { x: number; y: number } {
	return {
		x: pos.x + pos.width / 2,
		y: pos.y + pos.height / 2,
	}
}

/**
 * Get the connection point on a node edge closest to a target point
 */
export function getConnectionPoint(
	node: NodePosition,
	targetX: number,
	targetY: number,
): { x: number; y: number } {
	const center = getNodeCenter(node)
	const dx = targetX - center.x
	const dy = targetY - center.y

	// Determine which edge to connect to based on direction
	const absX = Math.abs(dx)
	const absY = Math.abs(dy)

	// Calculate intersection with node boundary
	if (absX > absY) {
		// Connect to left or right edge
		const edgeX = dx > 0 ? node.x + node.width : node.x
		const edgeY = center.y + (dy * (edgeX - center.x)) / dx
		return {
			x: edgeX,
			y: Math.max(node.y, Math.min(node.y + node.height, edgeY)),
		}
	}
	// Connect to top or bottom edge
	const edgeY = dy > 0 ? node.y + node.height : node.y
	const edgeX = center.x + (dx * (edgeY - center.y)) / (dy || 1)
	return {
		x: Math.max(node.x, Math.min(node.x + node.width, edgeX)),
		y: edgeY,
	}
}
