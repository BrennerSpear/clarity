/**
 * Render Excalidraw diagrams using ELK-computed positions
 *
 * Takes an InfraGraph and its ELK layout output to generate
 * Excalidraw elements with accurate positions and orthogonal arrows.
 */

import type { ElkEdgeSection, ElkGraph, ElkNode } from "../elk/types"
import type { InfraGraph, ServiceNode, ServiceType } from "../graph/types"
import type {
	ExcalidrawArrow,
	ExcalidrawDiamond,
	ExcalidrawElement,
	ExcalidrawEllipse,
	ExcalidrawFile,
	ExcalidrawRectangle,
	ExcalidrawText,
} from "./types"
import { LAYOUT_CONFIG, SERVICE_COLORS, SERVICE_SHAPES } from "./types"

/**
 * Generate a random seed for Excalidraw's hand-drawn style
 */
function generateSeed(): number {
	return Math.floor(Math.random() * 2147483647)
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
 * Get the shape type for a service type
 */
function getShapeType(
	serviceType: ServiceType,
): "rectangle" | "ellipse" | "diamond" {
	const shape = SERVICE_SHAPES[serviceType]
	if (shape === "ellipse" || shape === "diamond" || shape === "rectangle") {
		return shape
	}
	return "rectangle"
}

/**
 * Create a shape element for a service node (rectangle, ellipse, or diamond)
 */
function createNodeElement(
	node: ServiceNode,
	elkNode: ElkNode,
): ExcalidrawRectangle | ExcalidrawEllipse | ExcalidrawDiamond {
	const colors = getServiceColors(node.type)
	const textId = `${node.id}-text`
	const shapeType = getShapeType(node.type)

	return {
		id: node.id,
		type: shapeType,
		x: elkNode.x ?? 0,
		y: elkNode.y ?? 0,
		width: elkNode.width ?? 140,
		height: elkNode.height ?? 50,
		angle: 0,
		strokeColor: colors.stroke,
		backgroundColor: colors.background,
		fillStyle: "solid",
		strokeWidth: 2,
		strokeStyle: node.external ? "dashed" : "solid",
		roughness: 1,
		opacity: 100,
		groupIds: [],
		frameId: null,
		roundness: shapeType === "rectangle" ? { type: 3 } : null,
		seed: generateSeed(),
		version: 1,
		versionNonce: generateSeed(),
		isDeleted: false,
		boundElements: [{ id: textId, type: "text" }],
		updated: Date.now(),
		link: null,
		locked: false,
	} as ExcalidrawRectangle | ExcalidrawEllipse | ExcalidrawDiamond
}

/**
 * Create a text element bound to a node
 */
function createNodeText(node: ServiceNode, elkNode: ElkNode): ExcalidrawText {
	const x = elkNode.x ?? 0
	const y = elkNode.y ?? 0
	const width = elkNode.width ?? 140
	const height = elkNode.height ?? 50

	const fontSize = LAYOUT_CONFIG.fontSize
	const lineHeight = 1.25
	const textHeight = fontSize * lineHeight
	const avgCharWidth = fontSize * 0.6
	const textWidth = Math.min(node.name.length * avgCharWidth, width - 20)

	return {
		id: `${node.id}-text`,
		type: "text",
		x: x + (width - textWidth) / 2,
		y: y + (height - textHeight) / 2,
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
		text: node.name,
		fontSize,
		fontFamily: LAYOUT_CONFIG.fontFamily,
		textAlign: "center",
		verticalAlign: "middle",
		baseline: fontSize,
		containerId: node.id,
		originalText: node.name,
		autoResize: true,
		lineHeight,
	}
}

/**
 * Convert ELK edge section to Excalidraw arrow points
 *
 * ELK provides absolute coordinates, Excalidraw needs relative points
 * from the arrow's start position.
 */
function elkSectionToArrowPoints(section: ElkEdgeSection): {
	startX: number
	startY: number
	points: [number, number][]
} {
	const startX = section.startPoint.x
	const startY = section.startPoint.y

	// First point is always [0, 0] (relative to start)
	const points: [number, number][] = [[0, 0]]

	// Add bend points (relative to start)
	if (section.bendPoints) {
		for (const bend of section.bendPoints) {
			points.push([bend.x - startX, bend.y - startY])
		}
	}

	// Add end point (relative to start)
	points.push([section.endPoint.x - startX, section.endPoint.y - startY])

	return { startX, startY, points }
}

/**
 * Extract node ID from a port ID
 *
 * Port IDs have the format: `{nodeId}-{direction}-{index}`
 * e.g., "web-south-1" → "web", "redis-north-0" → "redis"
 *
 * If the ID doesn't match the port pattern, return it as-is (it's already a node ID)
 */
function extractNodeId(portOrNodeId: string): string {
	// Port IDs end with -{direction}-{number}
	const portPattern = /^(.+)-(north|south|east|west)-\d+$/
	const match = portOrNodeId.match(portPattern)
	return match ? match[1]! : portOrNodeId
}

/**
 * Calculate fixedPoint for a binding (normalized 0-1 coordinates)
 *
 * This tells Excalidraw exactly where on the node's bounding box
 * the arrow should attach, preserving ELK's computed attachment point.
 */
function calculateFixedPoint(
	connectionPoint: { x: number; y: number },
	elkNode: ElkNode,
): [number, number] {
	const nodeX = elkNode.x ?? 0
	const nodeY = elkNode.y ?? 0
	const nodeWidth = elkNode.width ?? 140
	const nodeHeight = elkNode.height ?? 50

	// Calculate normalized position (0-1) relative to node bounds
	let normalizedX = (connectionPoint.x - nodeX) / nodeWidth
	let normalizedY = (connectionPoint.y - nodeY) / nodeHeight

	// Clamp to valid range (sometimes ELK places points slightly outside)
	normalizedX = Math.max(0, Math.min(1, normalizedX))
	normalizedY = Math.max(0, Math.min(1, normalizedY))

	return [normalizedX, normalizedY]
}

/**
 * Create an arrow element from ELK edge data
 */
function createArrowElement(
	edgeId: string,
	sourcePortOrNodeId: string,
	targetPortOrNodeId: string,
	sections: ElkEdgeSection[],
	elkNodeMap: Map<string, ElkNode>,
): ExcalidrawArrow | null {
	if (!sections || sections.length === 0) {
		return null
	}

	// Use the first section (multi-section edges are rare)
	const section = sections[0]
	if (!section) return null

	const { startX, startY, points } = elkSectionToArrowPoints(section)

	// Extract actual node IDs (port IDs like "web-south-1" → "web")
	const sourceNodeId = extractNodeId(sourcePortOrNodeId)
	const targetNodeId = extractNodeId(targetPortOrNodeId)

	// Calculate fixedPoints to lock attachment positions
	const sourceNode = elkNodeMap.get(sourceNodeId)
	const targetNode = elkNodeMap.get(targetNodeId)

	const startFixedPoint = sourceNode
		? calculateFixedPoint(section.startPoint, sourceNode)
		: null

	const endFixedPoint = targetNode
		? calculateFixedPoint(section.endPoint, targetNode)
		: null

	return {
		id: edgeId,
		type: "arrow",
		x: startX,
		y: startY,
		width: Math.abs(points[points.length - 1]?.[0] ?? 0),
		height: Math.abs(points[points.length - 1]?.[1] ?? 0),
		angle: 0,
		strokeColor: "#868e96",
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
			elementId: sourceNodeId,
			focus: 0,
			gap: 1,
			fixedPoint: startFixedPoint,
		},
		endBinding: {
			elementId: targetNodeId,
			focus: 0,
			gap: 1,
			fixedPoint: endFixedPoint,
		},
		startArrowhead: null,
		endArrowhead: "arrow",
		elbowed: true,
	}
}

/**
 * Build a map of ELK node IDs to their layout data
 */
function buildElkNodeMap(elkGraph: ElkGraph): Map<string, ElkNode> {
	const map = new Map<string, ElkNode>()

	function addNodes(nodes: ElkNode[] | undefined) {
		if (!nodes) return
		for (const node of nodes) {
			map.set(node.id, node)
			// Recursively add children for compound nodes
			if (node.children) {
				addNodes(node.children)
			}
		}
	}

	addNodes(elkGraph.children)
	return map
}

export interface ElkRenderOptions {
	/** Padding to add around the diagram (default: 50) */
	padding?: number
}

/**
 * Render an InfraGraph to Excalidraw using ELK layout positions
 */
export function renderWithElkLayout(
	graph: InfraGraph,
	elkGraph: ElkGraph,
	options: ElkRenderOptions = {},
): ExcalidrawFile {
	const padding = options.padding ?? 50
	const elements: ExcalidrawElement[] = []

	// Build lookup map for ELK nodes
	const elkNodeMap = buildElkNodeMap(elkGraph)

	// Build offset node map (with padding applied) for arrow binding calculations
	const offsetElkNodeMap = new Map<string, ElkNode>()

	// Create node elements
	for (const node of graph.nodes) {
		const elkNode = elkNodeMap.get(node.id)
		if (!elkNode || elkNode.x === undefined || elkNode.y === undefined) {
			console.warn(`No ELK position for node: ${node.id}`)
			continue
		}

		// Offset by padding
		const offsetNode: ElkNode = {
			...elkNode,
			x: (elkNode.x ?? 0) + padding,
			y: (elkNode.y ?? 0) + padding,
		}

		// Store for arrow binding calculations
		offsetElkNodeMap.set(node.id, offsetNode)

		elements.push(createNodeElement(node, offsetNode))
		elements.push(createNodeText(node, offsetNode))
	}

	// Create arrow elements from ELK edges
	if (elkGraph.edges) {
		for (const edge of elkGraph.edges) {
			const sourceId = edge.sources[0]
			const targetId = edge.targets[0]

			if (!sourceId || !targetId) continue

			// Offset section points by padding
			const offsetSections = edge.sections?.map((section) => ({
				...section,
				startPoint: {
					x: section.startPoint.x + padding,
					y: section.startPoint.y + padding,
				},
				endPoint: {
					x: section.endPoint.x + padding,
					y: section.endPoint.y + padding,
				},
				bendPoints: section.bendPoints?.map((bp) => ({
					x: bp.x + padding,
					y: bp.y + padding,
				})),
			}))

			const arrow = createArrowElement(
				edge.id,
				sourceId,
				targetId,
				offsetSections ?? [],
				offsetElkNodeMap,
			)

			if (arrow) {
				elements.push(arrow)

				// Update bound elements on source and target nodes
				// Use extracted node IDs (port IDs like "web-south-1" → "web")
				const sourceNodeId = extractNodeId(sourceId)
				const targetNodeId = extractNodeId(targetId)

				const sourceEl = elements.find((e) => e.id === sourceNodeId)
				const targetEl = elements.find((e) => e.id === targetNodeId)

				if (sourceEl && "boundElements" in sourceEl) {
					sourceEl.boundElements = [
						...(sourceEl.boundElements ?? []),
						{ id: edge.id, type: "arrow" },
					]
				}
				if (targetEl && "boundElements" in targetEl) {
					targetEl.boundElements = [
						...(targetEl.boundElements ?? []),
						{ id: edge.id, type: "arrow" },
					]
				}
			}
		}
	}

	return {
		type: "excalidraw",
		version: 2,
		source: "clarity-elk",
		elements,
		appState: {
			viewBackgroundColor: "#ffffff",
			gridSize: null,
		},
		files: {},
	}
}
