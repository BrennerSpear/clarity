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
	ExcalidrawElement,
	ExcalidrawFile,
	ExcalidrawRectangle,
	ExcalidrawText,
} from "./types"
import { LAYOUT_CONFIG, SERVICE_COLORS } from "./types"

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
 * Create a rectangle element for a service node
 */
function createNodeElement(
	node: ServiceNode,
	elkNode: ElkNode,
): ExcalidrawRectangle {
	const colors = getServiceColors(node.type)
	const textId = `${node.id}-text`

	return {
		id: node.id,
		type: "rectangle",
		x: elkNode.x ?? 0,
		y: elkNode.y ?? 0,
		width: elkNode.width ?? 140,
		height: elkNode.height ?? 50,
		angle: 0,
		strokeColor: colors.stroke,
		backgroundColor: colors.background,
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
		boundElements: [{ id: textId, type: "text" }],
		updated: Date.now(),
		link: null,
		locked: false,
	}
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
function elkSectionToArrowPoints(
	section: ElkEdgeSection,
): { startX: number; startY: number; points: [number, number][] } {
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
 * Create an arrow element from ELK edge data
 */
function createArrowElement(
	edgeId: string,
	sourceId: string,
	targetId: string,
	sections: ElkEdgeSection[],
): ExcalidrawArrow | null {
	if (!sections || sections.length === 0) {
		return null
	}

	// Use the first section (multi-section edges are rare)
	const section = sections[0]
	if (!section) return null

	const { startX, startY, points } = elkSectionToArrowPoints(section)

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
			elementId: sourceId,
			focus: 0,
			gap: 1,
			fixedPoint: null,
		},
		endBinding: {
			elementId: targetId,
			focus: 0,
			gap: 1,
			fixedPoint: null,
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
			)

			if (arrow) {
				elements.push(arrow)

				// Update bound elements on source and target nodes
				const sourceEl = elements.find((e) => e.id === sourceId)
				const targetEl = elements.find((e) => e.id === targetId)

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
