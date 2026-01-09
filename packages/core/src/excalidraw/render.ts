/**
 * Render an InfraGraph to Excalidraw JSON format
 */

import type {
	DirectedEdge,
	EdgeDirection,
	GroupedGraph,
	ServiceGroup,
} from "../graph/grouping"
import { getEdgeDirectionColor, groupByDependencyPath } from "../graph/grouping"
import type {
	InfraGraph,
	ServiceCategory,
	ServiceNode,
	ServiceType,
} from "../graph/types"
import type { ResolutionLevel } from "../pipeline/types"
import {
	type NodePosition,
	calculateLayout,
	getConnectionPoint,
	getNodeCenter,
} from "./layout"
import {
	type SemanticPosition,
	calculateSemanticLayout,
} from "./semantic-layout"
import { createGrid, findOrthogonalPath } from "./pathfinding"
import {
	type ExcalidrawArrow,
	type ExcalidrawDiamond,
	type ExcalidrawElement,
	type ExcalidrawEllipse,
	type ExcalidrawFile,
	type ExcalidrawRectangle,
	type ExcalidrawText,
	LAYOUT_CONFIG,
	SERVICE_COLORS,
	SERVICE_SHAPES,
} from "./types"

/**
 * Generate a random seed for Excalidraw's hand-drawn style
 */
function generateSeed(): number {
	return Math.floor(Math.random() * 2147483647)
}

/**
 * Generate a unique ID
 */
function generateId(): string {
	return Math.random().toString(36).substring(2, 15)
}

/**
 * Get colors for a service type
 */
function getServiceColors(type: ServiceType): {
	stroke: string
	background: string
} {
	return (
		SERVICE_COLORS[type] ?? {
			stroke: "#495057",
			background: "#dee2e6",
		}
	)
}

/**
 * Get shape type for a service type
 */
function getServiceShape(
	type: ServiceType,
): "rectangle" | "ellipse" | "diamond" {
	const shape = SERVICE_SHAPES[type] ?? "rectangle"
	if (shape === "ellipse" || shape === "diamond" || shape === "rectangle") {
		return shape
	}
	return "rectangle"
}

/**
 * Create base element properties
 */
function createBaseElement(
	id: string,
	x: number,
	y: number,
	width: number,
	height: number,
): Omit<ExcalidrawRectangle, "type"> {
	return {
		id,
		x,
		y,
		width,
		height,
		angle: 0,
		strokeColor: "#1e1e1e",
		backgroundColor: "#ffffff",
		fillStyle: "solid",
		strokeWidth: 2,
		strokeStyle: "solid",
		roughness: 1,
		opacity: 100,
		groupIds: [],
		frameId: null,
		roundness: { type: 3 },
		seed: generateSeed(),
		version: 1,
		versionNonce: generateSeed(),
		isDeleted: false,
		boundElements: null,
		updated: Date.now(),
		link: null,
		locked: false,
	}
}

/**
 * Create a shape element (rectangle, ellipse, or diamond)
 */
function createShapeElement(
	id: string,
	type: "rectangle" | "ellipse" | "diamond",
	x: number,
	y: number,
	width: number,
	height: number,
	colors: { stroke: string; background: string },
): ExcalidrawRectangle | ExcalidrawEllipse | ExcalidrawDiamond {
	const base = createBaseElement(id, x, y, width, height)
	return {
		...base,
		type,
		strokeColor: colors.stroke,
		backgroundColor: colors.background,
	} as ExcalidrawRectangle | ExcalidrawEllipse | ExcalidrawDiamond
}

/**
 * Create a text element
 */
function createTextElement(
	id: string,
	text: string,
	containerX: number,
	containerY: number,
	containerWidth: number,
	containerHeight: number,
	containerId: string | null = null,
): ExcalidrawText {
	const fontSize = LAYOUT_CONFIG.fontSize
	const lineHeight = 1.25
	const textHeight = fontSize * lineHeight

	// Estimate text width (rough approximation)
	const avgCharWidth = fontSize * 0.6
	const textWidth = Math.min(text.length * avgCharWidth, containerWidth - 20)

	// For bound text, position at the center of the container
	// Excalidraw uses these coordinates as the text bounding box origin
	const x = containerX + (containerWidth - textWidth) / 2
	const y = containerY + (containerHeight - textHeight) / 2

	return {
		id,
		type: "text",
		x,
		y,
		width: textWidth,
		height: textHeight,
		angle: 0,
		strokeColor: "#1e1e1e",
		backgroundColor: "transparent",
		fillStyle: "solid",
		strokeWidth: 1,
		strokeStyle: "solid",
		roughness: 1,
		opacity: 100,
		groupIds: [],
		frameId: null,
		roundness: null,
		seed: generateSeed(),
		version: 1,
		versionNonce: generateSeed(),
		isDeleted: false,
		boundElements: null,
		updated: Date.now(),
		link: null,
		locked: false,
		text,
		fontSize,
		fontFamily: LAYOUT_CONFIG.fontFamily,
		textAlign: "center",
		verticalAlign: "middle",
		baseline: fontSize,
		containerId,
		originalText: text,
		autoResize: true,
		lineHeight,
	}
}

/**
 * Calculate orthogonal (right-angle) path between two nodes
 */
function calculateOrthogonalPath(
	startPos: NodePosition,
	endPos: NodePosition,
): { startPoint: { x: number; y: number }; points: [number, number][] } {
	const startCenter = getNodeCenter(startPos)
	const endCenter = getNodeCenter(endPos)

	const dx = endCenter.x - startCenter.x
	const dy = endCenter.y - startCenter.y

	// Determine primary direction based on relative positions
	const isMainlyVertical = Math.abs(dy) > Math.abs(dx)
	const goingDown = dy > 0
	const goingRight = dx > 0

	let startPoint: { x: number; y: number }
	let endPoint: { x: number; y: number }
	const points: [number, number][] = [[0, 0]]

	if (isMainlyVertical) {
		// Vertical routing: exit top/bottom, route horizontally if needed
		if (goingDown) {
			// Exit from bottom of start, enter top of end
			startPoint = { x: startCenter.x, y: startPos.y + startPos.height }
			endPoint = { x: endCenter.x, y: endPos.y }
		} else {
			// Exit from top of start, enter bottom of end
			startPoint = { x: startCenter.x, y: startPos.y }
			endPoint = { x: endCenter.x, y: endPos.y + endPos.height }
		}

		// Calculate midpoint for the horizontal segment
		const midY = (startPoint.y + endPoint.y) / 2

		if (Math.abs(dx) > 10) {
			// Need horizontal routing
			points.push([0, midY - startPoint.y]) // Go vertical to midpoint
			points.push([endPoint.x - startPoint.x, midY - startPoint.y]) // Go horizontal
			points.push([endPoint.x - startPoint.x, endPoint.y - startPoint.y]) // Go vertical to end
		} else {
			// Straight vertical
			points.push([endPoint.x - startPoint.x, endPoint.y - startPoint.y])
		}
	} else {
		// Horizontal routing: exit left/right, route vertically if needed
		if (goingRight) {
			// Exit from right of start, enter left of end
			startPoint = { x: startPos.x + startPos.width, y: startCenter.y }
			endPoint = { x: endPos.x, y: endCenter.y }
		} else {
			// Exit from left of start, enter right of end
			startPoint = { x: startPos.x, y: startCenter.y }
			endPoint = { x: endPos.x + endPos.width, y: endCenter.y }
		}

		// Calculate midpoint for the vertical segment
		const midX = (startPoint.x + endPoint.x) / 2

		if (Math.abs(dy) > 10) {
			// Need vertical routing
			points.push([midX - startPoint.x, 0]) // Go horizontal to midpoint
			points.push([midX - startPoint.x, endPoint.y - startPoint.y]) // Go vertical
			points.push([endPoint.x - startPoint.x, endPoint.y - startPoint.y]) // Go horizontal to end
		} else {
			// Straight horizontal
			points.push([endPoint.x - startPoint.x, endPoint.y - startPoint.y])
		}
	}

	return { startPoint, points }
}

/**
 * Calculate arrow path points based on routing mode
 */
function calculateArrowPath(
	startPos: NodePosition,
	endPos: NodePosition,
	useOrthogonal: boolean,
	grid?: ReturnType<typeof createGrid> | null,
): { startPoint: { x: number; y: number }; points: [number, number][] } {
	// A* pathfinding (best quality)
	if (useOrthogonal && grid) {
		const result = findOrthogonalPath(grid, startPos, endPos)
		return { startPoint: result.startPoint, points: result.path }
	}

	// Simple orthogonal routing (fallback)
	if (useOrthogonal) {
		const path = calculateOrthogonalPath(startPos, endPos)
		return { startPoint: path.startPoint, points: path.points }
	}

	// Straight line
	const startCenter = getNodeCenter(startPos)
	const endCenter = getNodeCenter(endPos)
	const startPoint = getConnectionPoint(startPos, endCenter.x, endCenter.y)
	const endPoint = getConnectionPoint(endPos, startCenter.x, startCenter.y)
	return {
		startPoint,
		points: [
			[0, 0],
			[endPoint.x - startPoint.x, endPoint.y - startPoint.y],
		],
	}
}

/**
 * Calculate bounding box from path points
 */
function calculatePathBounds(points: [number, number][]): {
	minX: number
	maxX: number
	minY: number
	maxY: number
} {
	let minX = 0
	let maxX = 0
	let minY = 0
	let maxY = 0
	for (const [px, py] of points) {
		minX = Math.min(minX, px)
		maxX = Math.max(maxX, px)
		minY = Math.min(minY, py)
		maxY = Math.max(maxY, py)
	}
	return { minX, maxX, minY, maxY }
}

/**
 * Create an arrow element connecting two nodes
 */
function createArrowElement(
	id: string,
	startPos: NodePosition,
	endPos: NodePosition,
	startId: string,
	endId: string,
	color?: string,
	useOrthogonal = true,
	grid?: ReturnType<typeof createGrid> | null,
): ExcalidrawArrow {
	const { startPoint, points } = calculateArrowPath(
		startPos,
		endPos,
		useOrthogonal,
		grid,
	)
	const bounds = calculatePathBounds(points)

	return {
		id,
		type: "arrow",
		x: startPoint.x,
		y: startPoint.y,
		width: bounds.maxX - bounds.minX,
		height: bounds.maxY - bounds.minY,
		angle: 0,
		strokeColor: color ?? "#868e96",
		backgroundColor: "transparent",
		fillStyle: "solid",
		strokeWidth: 2,
		strokeStyle: "solid",
		roughness: 0, // No roughness for cleaner lines
		opacity: 100,
		groupIds: [],
		frameId: null,
		roundness: null, // No rounding for sharp corners
		seed: generateSeed(),
		version: 1,
		versionNonce: generateSeed(),
		isDeleted: false,
		boundElements: null,
		updated: Date.now(),
		link: null,
		locked: false,
		points,
		startBinding: {
			elementId: startId,
			focus: 0,
			gap: 1,
		},
		endBinding: {
			elementId: endId,
			focus: 0,
			gap: 1,
		},
		startArrowhead: null,
		endArrowhead: "arrow",
		elbowed: useOrthogonal, // Excalidraw will apply elbow routing
	}
}

/**
 * Render a service node to Excalidraw elements
 */
function renderServiceNode(
	node: ServiceNode,
	position: NodePosition,
): ExcalidrawElement[] {
	const elements: ExcalidrawElement[] = []
	const shapeId = `shape-${node.id}`
	const textId = `text-${node.id}`

	const colors = getServiceColors(node.type)
	const shapeType = getServiceShape(node.type)

	// Create shape element
	const shape = createShapeElement(
		shapeId,
		shapeType,
		position.x,
		position.y,
		position.width,
		position.height,
		colors,
	)

	// Add bound text reference
	shape.boundElements = [{ id: textId, type: "text" }]
	elements.push(shape)

	// Create text element (centered in shape)
	const text = createTextElement(
		textId,
		node.name,
		position.x,
		position.y,
		position.width,
		position.height,
		shapeId,
	)
	elements.push(text)

	return elements
}

/**
 * Render a service group to Excalidraw elements
 */
function renderServiceGroup(
	group: ServiceGroup,
	position: NodePosition,
): ExcalidrawElement[] {
	const elements: ExcalidrawElement[] = []
	const shapeId = `shape-${group.id}`
	const textId = `text-${group.id}`

	// Groups use a distinct color (purple/violet for grouping)
	const colors = {
		stroke: "#7048e8",
		background: "#e5dbff",
	}

	// Create shape element (rectangle for groups)
	const shape = createShapeElement(
		shapeId,
		"rectangle",
		position.x,
		position.y,
		position.width,
		position.height,
		colors,
	)

	// Add bound text reference
	shape.boundElements = [{ id: textId, type: "text" }]
	elements.push(shape)

	// Create text element (centered in shape)
	const text = createTextElement(
		textId,
		group.name,
		position.x,
		position.y,
		position.width,
		position.height,
		shapeId,
	)
	elements.push(text)

	return elements
}

export interface RenderOptions {
	nodeWidth?: number
	nodeHeight?: number
	horizontalGap?: number
	verticalGap?: number
	resolution?: ResolutionLevel
}

export interface GroupedRenderOptions extends RenderOptions {
	/** Minimum number of services to form a group (default: 2) */
	minGroupSize?: number
	/** Show edge direction colors */
	showEdgeDirection?: boolean
	/** Use semantic left-to-right layout (default: true) */
	useSemanticLayout?: boolean
	/** Use orthogonal (right-angle) arrows instead of straight (default: true) */
	orthogonalArrows?: boolean
}

/**
 * Render an InfraGraph to Excalidraw JSON format
 */
export function renderToExcalidraw(
	graph: InfraGraph,
	options?: RenderOptions,
): ExcalidrawFile {
	const elements: ExcalidrawElement[] = []

	// Calculate layout
	const layout = calculateLayout(graph, options)

	// Render nodes
	for (const node of graph.nodes) {
		const position = layout.positions.get(node.id)
		if (position) {
			elements.push(...renderServiceNode(node, position))
		}
	}

	// Deduplicate edges for rendering - only need one arrow per node pair
	// Prefer explicit edges: depends_on > link > network > volume > inferred
	const edgePriority: Record<string, number> = {
		depends_on: 5,
		link: 4,
		network: 3,
		volume: 2,
		inferred: 1,
	}
	const edgeMap = new Map<string, (typeof graph.edges)[0]>()
	for (const edge of graph.edges) {
		const key = `${edge.from}->${edge.to}`
		const existing = edgeMap.get(key)
		const edgePrio = edgePriority[edge.type] ?? 0
		const existingPrio = existing ? (edgePriority[existing.type] ?? 0) : 0
		if (!existing || edgePrio > existingPrio) {
			edgeMap.set(key, edge)
		}
	}

	// Render edges as arrows
	for (const edge of edgeMap.values()) {
		const fromPos = layout.positions.get(edge.from)
		const toPos = layout.positions.get(edge.to)

		if (fromPos && toPos) {
			const arrowId = `arrow-${edge.from}-${edge.to}`
			const arrow = createArrowElement(
				arrowId,
				fromPos,
				toPos,
				`shape-${edge.from}`,
				`shape-${edge.to}`,
			)
			elements.push(arrow)
		}
	}

	return {
		type: "excalidraw",
		version: 2,
		source: "clarity",
		elements,
		appState: {
			viewBackgroundColor: "#ffffff",
			gridSize: null,
		},
		files: {},
	}
}

/**
 * Convert Excalidraw file to JSON string
 */
export function excalidrawToJson(file: ExcalidrawFile): string {
	return JSON.stringify(file, null, 2)
}

/**
 * Render an InfraGraph with dependency path grouping
 *
 * Groups services that have identical dependencies into single nodes,
 * and uses colored arrows to show read/write direction.
 */
export function renderGroupedToExcalidraw(
	graph: InfraGraph,
	options?: GroupedRenderOptions,
): ExcalidrawFile {
	const {
		minGroupSize = 2,
		showEdgeDirection = true,
		useSemanticLayout = true,
		orthogonalArrows = true,
		...layoutOptions
	} = options ?? {}

	// Group services by dependency path
	const grouped = groupByDependencyPath(graph, {
		minGroupSize,
		excludeTypes: ["database", "cache", "queue", "storage"], // Don't group infrastructure
	})

	const elements: ExcalidrawElement[] = []

	// Calculate layout
	let positions: Map<string, NodePosition>

	if (useSemanticLayout) {
		// Build a graph with only the nodes being rendered
		const renderedGraph: InfraGraph = {
			nodes: grouped.nodes, // Only individual nodes that weren't grouped
			edges: graph.edges.filter(
				(e) =>
					grouped.nodes.some((n) => n.id === e.from) ||
					grouped.nodes.some((n) => n.id === e.to),
			),
			metadata: graph.metadata,
		}

		// Use semantic layout (left-to-right flow by role)
		const semanticPositions = calculateSemanticLayout(
			renderedGraph,
			grouped.groups,
			{
				nodeWidth: 180,
				nodeHeight: 70,
				helperWidth: 130,
				helperHeight: 50,
				columnGap: 220,
				rowGap: 30,
			},
		)

		// Convert SemanticPosition to NodePosition
		positions = new Map()
		for (const [id, pos] of semanticPositions) {
			positions.set(id, {
				id: pos.id,
				x: pos.x,
				y: pos.y,
				width: pos.width,
				height: pos.height,
				layer: pos.column,
			})
		}
	} else {
		// Use standard layout
		const layoutNodes: ServiceNode[] = [
			...grouped.nodes,
			...grouped.groups.map((g) => ({
				id: g.id,
				name: g.name,
				type: "container" as ServiceType,
				source: { file: "grouped", format: "docker-compose" as const },
			})),
		]

		const layoutEdges = grouped.edges.map((e) => ({
			from: e.from,
			to: e.to,
			type: e.type,
		}))

		const layoutGraph: InfraGraph = {
			nodes: layoutNodes,
			edges: layoutEdges,
			metadata: graph.metadata,
		}

		const layout = calculateLayout(layoutGraph, {
			...layoutOptions,
			nodeWidth: 200,
			nodeHeight: 80,
		})
		positions = layout.positions
	}

	// Render individual nodes
	for (const node of grouped.nodes) {
		const position = positions.get(node.id)
		if (position) {
			elements.push(...renderServiceNode(node, position))
		}
	}

	// Render groups
	for (const group of grouped.groups) {
		const position = positions.get(group.id)
		if (position) {
			elements.push(...renderServiceGroup(group, position))
		}
	}

	// Create pathfinding grid if using orthogonal arrows
	const grid = orthogonalArrows ? createGrid(positions) : null

	// Render edges with direction colors
	const processedEdges = new Set<string>()
	for (const edge of grouped.edges) {
		const edgeKey = `${edge.from}->${edge.to}`
		if (processedEdges.has(edgeKey)) continue
		processedEdges.add(edgeKey)

		const fromPos = positions.get(edge.from)
		const toPos = positions.get(edge.to)

		if (fromPos && toPos) {
			const arrowId = `arrow-${edge.from}-${edge.to}`
			const color = showEdgeDirection
				? getEdgeDirectionColor(edge.direction)
				: undefined
			const arrow = createArrowElement(
				arrowId,
				fromPos,
				toPos,
				`shape-${edge.from}`,
				`shape-${edge.to}`,
				color,
				orthogonalArrows,
				grid,
			)
			elements.push(arrow)
		}
	}

	return {
		type: "excalidraw",
		version: 2,
		source: "clarity",
		elements,
		appState: {
			viewBackgroundColor: "#ffffff",
			gridSize: null,
		},
		files: {},
	}
}

/**
 * Colors for different service categories
 */
const CATEGORY_COLORS: Record<
	ServiceCategory,
	{ stroke: string; background: string }
> = {
	"data-layer": {
		stroke: "#1971c2",
		background: "#a5d8ff",
	},
	"application-layer": {
		stroke: "#0c8599",
		background: "#99e9f2",
	},
	infrastructure: {
		stroke: "#7950f2",
		background: "#d0bfff",
	},
	monitoring: {
		stroke: "#2f9e44",
		background: "#b2f2bb",
	},
	security: {
		stroke: "#e03131",
		background: "#ffc9c9",
	},
}

/**
 * Get colors for a service category (for grouped views)
 */
function getCategoryColors(category?: ServiceCategory): {
	stroke: string
	background: string
} {
	if (category && CATEGORY_COLORS[category]) {
		return CATEGORY_COLORS[category]
	}
	return {
		stroke: "#495057",
		background: "#dee2e6",
	}
}

/**
 * Group nodes by their category
 */
function groupNodesByCategory(
	nodes: ServiceNode[],
): Map<ServiceCategory | "ungrouped", ServiceNode[]> {
	const groups = new Map<ServiceCategory | "ungrouped", ServiceNode[]>()

	for (const node of nodes) {
		const category = node.category ?? "ungrouped"
		if (!groups.has(category)) {
			groups.set(category, [])
		}
		groups.get(category)?.push(node)
	}

	return groups
}

/**
 * Group nodes by their LLM-assigned group name
 */
function groupNodesByGroupName(
	nodes: ServiceNode[],
): Map<string, ServiceNode[]> {
	const groups = new Map<string, ServiceNode[]>()

	for (const node of nodes) {
		const groupName = node.group ?? "Other"
		if (!groups.has(groupName)) {
			groups.set(groupName, [])
		}
		groups.get(groupName)?.push(node)
	}

	return groups
}

/**
 * Create a grouped graph for executive view
 * Consolidates services by category into single nodes
 */
function createExecutiveGraph(graph: InfraGraph): InfraGraph {
	const categoryGroups = groupNodesByCategory(graph.nodes)

	const nodes: ServiceNode[] = []
	const categoryToNodeId = new Map<string, string>()

	// Create one node per category
	for (const [category, categoryNodes] of categoryGroups.entries()) {
		const nodeId = `category-${category}`
		categoryToNodeId.set(category, nodeId)

		// Determine dominant type in category
		const typeCounts = new Map<ServiceType, number>()
		for (const node of categoryNodes) {
			typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1)
		}
		let dominantType: ServiceType = "container"
		let maxCount = 0
		for (const [type, count] of typeCounts) {
			if (count > maxCount) {
				maxCount = count
				dominantType = type
			}
		}

		const categoryLabel =
			category === "ungrouped"
				? "Other Services"
				: category
						.split("-")
						.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
						.join(" ")

		nodes.push({
			id: nodeId,
			name: `${categoryLabel}\n(${categoryNodes.length} services)`,
			type: dominantType,
			category: category === "ungrouped" ? undefined : category,
			source: { file: "aggregated", format: "docker-compose" },
		})
	}

	// Create edges between categories based on original edges
	const edgeSet = new Set<string>()
	const edges: InfraGraph["edges"] = []

	for (const edge of graph.edges) {
		const fromNode = graph.nodes.find((n) => n.id === edge.from)
		const toNode = graph.nodes.find((n) => n.id === edge.to)

		if (fromNode && toNode) {
			const fromCategory = fromNode.category ?? "ungrouped"
			const toCategory = toNode.category ?? "ungrouped"

			// Skip self-edges within category
			if (fromCategory === toCategory) continue

			const fromId = categoryToNodeId.get(fromCategory)
			const toId = categoryToNodeId.get(toCategory)

			if (fromId && toId) {
				const edgeKey = `${fromId}->${toId}`
				if (!edgeSet.has(edgeKey)) {
					edgeSet.add(edgeKey)
					edges.push({
						from: fromId,
						to: toId,
						type: "inferred",
					})
				}
			}
		}
	}

	return {
		nodes,
		edges,
		metadata: {
			...graph.metadata,
			parserVersion: `${graph.metadata.parserVersion}-executive`,
		},
	}
}

/**
 * Create a grouped graph showing service groups
 * Consolidates services by their group name
 */
function createGroupsGraph(graph: InfraGraph): InfraGraph {
	const groupedNodes = groupNodesByGroupName(graph.nodes)

	const nodes: ServiceNode[] = []
	const groupToNodeId = new Map<string, string>()

	// Create one node per group
	for (const [groupName, groupNodes] of groupedNodes.entries()) {
		const nodeId = `group-${groupName.toLowerCase().replace(/\s+/g, "-")}`
		groupToNodeId.set(groupName, nodeId)

		// Determine dominant type and category in group
		const typeCounts = new Map<ServiceType, number>()
		const categoryCounts = new Map<ServiceCategory | undefined, number>()

		for (const node of groupNodes) {
			typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1)
			categoryCounts.set(
				node.category,
				(categoryCounts.get(node.category) ?? 0) + 1,
			)
		}

		let dominantType: ServiceType = "container"
		let maxTypeCount = 0
		for (const [type, count] of typeCounts) {
			if (count > maxTypeCount) {
				maxTypeCount = count
				dominantType = type
			}
		}

		let dominantCategory: ServiceCategory | undefined
		let maxCategoryCount = 0
		for (const [category, count] of categoryCounts) {
			if (count > maxCategoryCount) {
				maxCategoryCount = count
				dominantCategory = category
			}
		}

		nodes.push({
			id: nodeId,
			name: `${groupName}\n(${groupNodes.length} services)`,
			type: dominantType,
			category: dominantCategory,
			group: groupName,
			source: { file: "aggregated", format: "docker-compose" },
		})
	}

	// Create edges between groups based on original edges
	const edgeSet = new Set<string>()
	const edges: InfraGraph["edges"] = []

	for (const edge of graph.edges) {
		const fromNode = graph.nodes.find((n) => n.id === edge.from)
		const toNode = graph.nodes.find((n) => n.id === edge.to)

		if (fromNode && toNode) {
			const fromGroup = fromNode.group ?? "Other"
			const toGroup = toNode.group ?? "Other"

			// Skip self-edges within group
			if (fromGroup === toGroup) continue

			const fromId = groupToNodeId.get(fromGroup)
			const toId = groupToNodeId.get(toGroup)

			if (fromId && toId) {
				const edgeKey = `${fromId}->${toId}`
				if (!edgeSet.has(edgeKey)) {
					edgeSet.add(edgeKey)
					edges.push({
						from: fromId,
						to: toId,
						type: "inferred",
					})
				}
			}
		}
	}

	return {
		nodes,
		edges,
		metadata: {
			...graph.metadata,
			parserVersion: `${graph.metadata.parserVersion}-groups`,
		},
	}
}

/**
 * Render graph at a specific resolution level
 */
export function renderAtResolution(
	graph: InfraGraph,
	resolution: ResolutionLevel,
	options?: Omit<RenderOptions, "resolution">,
): ExcalidrawFile {
	switch (resolution) {
		case "executive":
			// High-level view: one node per category
			return renderToExcalidraw(createExecutiveGraph(graph), {
				...options,
				nodeWidth: 220,
				nodeHeight: 100,
			})

		case "groups":
			// Group view: one node per LLM-assigned group
			return renderToExcalidraw(createGroupsGraph(graph), {
				...options,
				nodeWidth: 200,
				nodeHeight: 90,
			})

		case "services":
			// Full service map (default view)
			return renderToExcalidraw(graph, options)

		case "detailed":
			// Detailed view with extra info (same as services for now)
			return renderToExcalidraw(graph, {
				...options,
				nodeWidth: 200,
				nodeHeight: 100,
			})

		default:
			return renderToExcalidraw(graph, options)
	}
}

/**
 * Render graph at all resolution levels
 */
export function renderAllResolutions(
	graph: InfraGraph,
	resolutions: ResolutionLevel[] = ["executive", "groups", "services"],
	options?: Omit<RenderOptions, "resolution">,
): Map<ResolutionLevel, ExcalidrawFile> {
	const results = new Map<ResolutionLevel, ExcalidrawFile>()

	for (const resolution of resolutions) {
		results.set(resolution, renderAtResolution(graph, resolution, options))
	}

	return results
}
