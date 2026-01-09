/**
 * Semantic layout algorithm for infrastructure graphs
 *
 * Organizes services by their role in the data flow:
 * Entry Points → Producers → Queues → Consumers → Databases
 */

import type { DependencyEdge, InfraGraph, ServiceNode, ServiceType } from "../graph/types"
import type { ServiceGroup } from "../graph/grouping"
import { LAYOUT_CONFIG } from "./types"

/**
 * Service role in the architecture
 */
export type ServiceRole =
	| "entry"      // nginx, load balancers
	| "gateway"    // relay, API gateways
	| "app"        // web, main application
	| "producer"   // services that write to queues
	| "queue"      // kafka, rabbitmq
	| "consumer"   // services that read from queues
	| "database"   // postgres, clickhouse, mysql
	| "cache"      // redis, memcached
	| "storage"    // s3, seaweedfs
	| "helper"     // pgbouncer, proxies, sidecars

/**
 * Position info for layout
 */
export interface SemanticPosition {
	id: string
	x: number
	y: number
	width: number
	height: number
	role: ServiceRole
	column: number
	isHelper: boolean
	parentId?: string // For helpers, which service they're attached to
	connectionCount?: number // Number of edges connected to this node
}

/**
 * Count connections for each node
 */
function countConnections(
	nodeId: string,
	edges: DependencyEdge[],
): number {
	return edges.filter(e => e.from === nodeId || e.to === nodeId).length
}

/**
 * Calculate dynamic node size based on connections
 */
function calculateNodeSize(
	connectionCount: number,
	baseWidth: number,
	baseHeight: number,
	isGroup: boolean,
): { width: number; height: number } {
	// Groups get extra width for the label
	const groupBonus = isGroup ? 40 : 0

	// Scale based on connections (more connections = larger node)
	// Use sqrt to prevent huge nodes
	const scaleFactor = Math.sqrt(Math.max(1, connectionCount)) / 2
	const connectionBonus = Math.min(scaleFactor * 30, 100) // Cap at +100px

	return {
		width: baseWidth + groupBonus + connectionBonus,
		height: baseHeight + connectionBonus * 0.5,
	}
}

/**
 * Helper service patterns - services that are proxies/sidecars for other services
 */
const HELPER_PATTERNS: { pattern: RegExp; parentType: ServiceType; parentPattern?: RegExp }[] = [
	{ pattern: /pgbouncer/i, parentType: "database", parentPattern: /postgres/i },
	{ pattern: /taskbroker/i, parentType: "queue", parentPattern: /kafka/i },
	{ pattern: /uptime-checker/i, parentType: "queue", parentPattern: /kafka/i },
	{ pattern: /-cleanup$/i, parentType: "container" }, // cleanup jobs
	{ pattern: /-proxy$/i, parentType: "container" },
	{ pattern: /-sidecar$/i, parentType: "container" },
]

/**
 * Detect the role of a service based on its name and type
 */
export function detectServiceRole(node: ServiceNode, edges: DependencyEdge[]): ServiceRole {
	const name = node.name.toLowerCase()
	const type = node.type

	// Check if it's a helper first
	for (const helper of HELPER_PATTERNS) {
		if (helper.pattern.test(name)) {
			return "helper"
		}
	}

	// Entry points
	if (name.includes("nginx") || name.includes("haproxy") || name.includes("traefik")) {
		return "entry"
	}

	// Gateways
	if (name.includes("relay") || name.includes("gateway") || name.includes("ingress")) {
		return "gateway"
	}

	// Queues
	if (type === "queue" || name.includes("kafka") || name.includes("rabbitmq") || name.includes("nats")) {
		return "queue"
	}

	// Databases
	if (type === "database" || name.includes("postgres") || name.includes("mysql") ||
		name.includes("clickhouse") || name.includes("mongo")) {
		return "database"
	}

	// Cache
	if (type === "cache" || name.includes("redis") || name.includes("memcached")) {
		return "cache"
	}

	// Storage
	if (type === "storage" || name.includes("seaweed") || name.includes("minio") || name.includes("s3")) {
		return "storage"
	}

	// Consumers - check name patterns
	if (name.includes("consumer") || name.includes("subscriber") || name.includes("worker")) {
		return "consumer"
	}

	// Check if it's a producer (writes to queue but doesn't have consumer in name)
	const writesToQueue = edges.some(e => {
		if (e.from !== node.id) return false
		// Would need to check if target is a queue
		return false // Simplified for now
	})

	// Main application services
	if (name === "web" || name.includes("api") || name.includes("app")) {
		return "app"
	}

	// Default to producer for services that connect to queues
	return "producer"
}

/**
 * Find which service a helper is attached to
 */
function findHelperParent(
	helperNode: ServiceNode,
	allNodes: ServiceNode[],
	edges: DependencyEdge[],
): string | undefined {
	const name = helperNode.name.toLowerCase()

	for (const helper of HELPER_PATTERNS) {
		if (helper.pattern.test(name)) {
			// Find a node that matches the parent pattern
			if (helper.parentPattern) {
				const parent = allNodes.find(n =>
					helper.parentPattern!.test(n.name.toLowerCase()) &&
					n.type === helper.parentType
				)
				if (parent) return parent.id
			}

			// Or find by type and edge connection
			const connectedTo = edges
				.filter(e => e.from === helperNode.id)
				.map(e => e.to)

			const parent = allNodes.find(n =>
				connectedTo.includes(n.id) && n.type === helper.parentType
			)
			if (parent) return parent.id
		}
	}

	return undefined
}

/**
 * Simplified column order - just 4 main columns
 */
const ROLE_COLUMNS: Record<ServiceRole, number> = {
	entry: 0,
	gateway: 0,
	app: 1,
	producer: 1,
	queue: 2,
	consumer: 3,
	cache: 4,
	database: 4,
	storage: 4,
	helper: -1,
}

/**
 * Calculate semantic layout for a graph
 */
export function calculateSemanticLayout(
	graph: InfraGraph,
	groups: ServiceGroup[] = [],
	options?: {
		nodeWidth?: number
		nodeHeight?: number
		helperWidth?: number
		helperHeight?: number
		columnGap?: number
		rowGap?: number
	}
): Map<string, SemanticPosition> {
	const {
		nodeWidth = 180,
		nodeHeight = 70,
		helperWidth = 130,
		helperHeight = 50,
		columnGap = 220,
		rowGap = 30,
	} = options ?? {}

	const positions = new Map<string, SemanticPosition>()

	// Detect roles for all nodes
	const nodeRoles = new Map<string, ServiceRole>()
	const nodeParents = new Map<string, string>()

	for (const node of graph.nodes) {
		const role = detectServiceRole(node, graph.edges)
		nodeRoles.set(node.id, role)

		if (role === "helper") {
			const parent = findHelperParent(node, graph.nodes, graph.edges)
			if (parent) {
				nodeParents.set(node.id, parent)
			}
		}
	}

	// Groups are typically consumers
	for (const group of groups) {
		const hasConsumers = group.services.some(s =>
			s.name.toLowerCase().includes("consumer")
		)
		nodeRoles.set(group.id, hasConsumers ? "consumer" : "producer")
	}

	// Count connections for dynamic sizing
	const connectionCounts = new Map<string, number>()
	for (const node of graph.nodes) {
		connectionCounts.set(node.id, countConnections(node.id, graph.edges))
	}
	// Groups inherit connection counts from their dependencies
	for (const group of groups) {
		// Count unique connections from group to other nodes
		const groupConnections = group.dependencies.length
		connectionCounts.set(group.id, groupConnections)
	}

	// Build list of nodes to position (excluding helpers, they go with parents)
	const nodesToPosition: { id: string; role: ServiceRole; isGroup: boolean; connections: number }[] = []

	for (const node of graph.nodes) {
		const role = nodeRoles.get(node.id) ?? "producer"
		if (role !== "helper") {
			nodesToPosition.push({
				id: node.id,
				role,
				isGroup: false,
				connections: connectionCounts.get(node.id) ?? 0,
			})
		}
	}

	for (const group of groups) {
		const role = nodeRoles.get(group.id) ?? "consumer"
		nodesToPosition.push({
			id: group.id,
			role,
			isGroup: true,
			connections: connectionCounts.get(group.id) ?? 0,
		})
	}

	// Group by column
	const columns = new Map<number, typeof nodesToPosition>()
	for (const node of nodesToPosition) {
		const col = ROLE_COLUMNS[node.role]
		if (!columns.has(col)) {
			columns.set(col, [])
		}
		columns.get(col)!.push(node)
	}

	// Compact columns - renumber to remove gaps
	const usedColumns = [...columns.keys()].sort((a, b) => a - b)
	const columnMapping = new Map<number, number>()
	usedColumns.forEach((col, idx) => columnMapping.set(col, idx))

	// Calculate sizes for all nodes first
	const nodeSizes = new Map<string, { width: number; height: number }>()
	for (const nodes of columns.values()) {
		for (const node of nodes) {
			const size = calculateNodeSize(node.connections, nodeWidth, nodeHeight, node.isGroup)
			nodeSizes.set(node.id, size)
		}
	}

	// Find max column height and width for centering
	let maxColumnHeight = 0
	const columnWidths = new Map<number, number>()

	for (const [origCol, nodes] of columns) {
		let colHeight = 0
		let maxWidth = 0
		for (const node of nodes) {
			const size = nodeSizes.get(node.id)!
			colHeight += size.height + rowGap
			maxWidth = Math.max(maxWidth, size.width)
		}
		colHeight -= rowGap
		maxColumnHeight = Math.max(maxColumnHeight, colHeight)
		columnWidths.set(origCol, maxWidth)
	}

	// Calculate column X positions based on actual widths
	const columnXPositions = new Map<number, number>()
	let currentX = 0
	for (const origCol of usedColumns) {
		columnXPositions.set(origCol, currentX)
		currentX += (columnWidths.get(origCol) ?? nodeWidth) + columnGap
	}

	// Position nodes in each column, centered vertically
	for (const [origCol, nodes] of columns) {
		const x = columnXPositions.get(origCol) ?? 0
		const colWidth = columnWidths.get(origCol) ?? nodeWidth

		// Calculate actual column height
		let colHeight = 0
		for (const node of nodes) {
			const size = nodeSizes.get(node.id)!
			colHeight += size.height + rowGap
		}
		colHeight -= rowGap

		const startY = (maxColumnHeight - colHeight) / 2
		let currentY = startY

		for (const node of nodes) {
			const size = nodeSizes.get(node.id)!
			// Center node horizontally within column
			const nodeX = x + (colWidth - size.width) / 2

			positions.set(node.id, {
				id: node.id,
				x: nodeX,
				y: currentY,
				width: size.width,
				height: size.height,
				role: node.role,
				column: columnMapping.get(origCol) ?? 0,
				isHelper: false,
				connectionCount: node.connections,
			})

			currentY += size.height + rowGap
		}
	}

	// Position helpers next to their parents
	for (const [helperId, parentId] of nodeParents) {
		const parentPos = positions.get(parentId)
		if (!parentPos) continue

		// Count existing helpers for this parent
		const existingHelpers = [...positions.values()].filter(
			p => p.parentId === parentId
		).length

		// Position helper above the parent, offset to the left
		positions.set(helperId, {
			id: helperId,
			x: parentPos.x - 40,
			y: parentPos.y - helperHeight - 15 - existingHelpers * (helperHeight + 10),
			width: helperWidth,
			height: helperHeight,
			role: "helper",
			column: parentPos.column,
			isHelper: true,
			parentId,
		})
	}

	return positions
}
