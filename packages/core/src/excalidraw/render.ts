/**
 * Render an InfraGraph to Excalidraw JSON format
 */

import type {
	DirectedEdge,
	EdgeDirection,
	GroupedGraph,
	ServiceGroup,
} from "../graph/grouping"
import {
	getEdgeDirectionColor,
	groupByDependencyPath,
} from "../graph/grouping"
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
	x: number,
	y: number,
	width: number,
	containerId: string | null = null,
): ExcalidrawText {
	const fontSize = LAYOUT_CONFIG.fontSize
	const lineHeight = 1.25

	return {
		id,
		type: "text",
		x,
		y,
		width,
		height: fontSize * lineHeight,
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
 * Create an arrow element connecting two nodes
 */
function createArrowElement(
	id: string,
	startPos: NodePosition,
	endPos: NodePosition,
	startId: string,
	endId: string,
	color?: string,
): ExcalidrawArrow {
	const startCenter = getNodeCenter(startPos)
	const endCenter = getNodeCenter(endPos)

	// Get connection points on node boundaries
	const startPoint = getConnectionPoint(startPos, endCenter.x, endCenter.y)
	const endPoint = getConnectionPoint(endPos, startCenter.x, startCenter.y)

	// Calculate relative points for the arrow
	const points: [number, number][] = [
		[0, 0],
		[endPoint.x - startPoint.x, endPoint.y - startPoint.y],
	]

	return {
		id,
		type: "arrow",
		x: startPoint.x,
		y: startPoint.y,
		width: Math.abs(endPoint.x - startPoint.x),
		height: Math.abs(endPoint.y - startPoint.y),
		angle: 0,
		strokeColor: color ?? "#868e96",
		backgroundColor: "transparent",
		fillStyle: "solid",
		strokeWidth: 2,
		strokeStyle: "solid",
		roughness: 1,
		opacity: 100,
		groupIds: [],
		frameId: null,
		roundness: { type: 2 },
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
		position.x + position.width / 2,
		position.y + position.height / 2,
		position.width - LAYOUT_CONFIG.textPadding * 2,
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
		position.x + position.width / 2,
		position.y + position.height / 2,
		position.width - LAYOUT_CONFIG.textPadding * 2,
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
	const { minGroupSize = 2, showEdgeDirection = true, ...layoutOptions } =
		options ?? {}

	// Group services by dependency path
	const grouped = groupByDependencyPath(graph, {
		minGroupSize,
		excludeTypes: ["database", "cache", "queue", "storage"], // Don't group infrastructure
	})

	const elements: ExcalidrawElement[] = []

	// Build a combined graph for layout calculation
	// This includes both individual nodes and groups
	const layoutNodes: ServiceNode[] = [
		...grouped.nodes,
		// Create pseudo-nodes for groups
		...grouped.groups.map((g) => ({
			id: g.id,
			name: g.name,
			type: "container" as ServiceType,
			source: { file: "grouped", format: "docker-compose" as const },
		})),
	]

	// Build edges for layout (from groups and individuals to their dependencies)
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

	// Calculate layout with wider nodes for groups
	const layout = calculateLayout(layoutGraph, {
		...layoutOptions,
		nodeWidth: 200, // Wider to fit group names
		nodeHeight: 80,
	})

	// Render individual nodes
	for (const node of grouped.nodes) {
		const position = layout.positions.get(node.id)
		if (position) {
			elements.push(...renderServiceNode(node, position))
		}
	}

	// Render groups
	for (const group of grouped.groups) {
		const position = layout.positions.get(group.id)
		if (position) {
			elements.push(...renderServiceGroup(group, position))
		}
	}

	// Render edges with direction colors
	const processedEdges = new Set<string>()
	for (const edge of grouped.edges) {
		const edgeKey = `${edge.from}->${edge.to}`
		if (processedEdges.has(edgeKey)) continue
		processedEdges.add(edgeKey)

		const fromPos = layout.positions.get(edge.from)
		const toPos = layout.positions.get(edge.to)

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
