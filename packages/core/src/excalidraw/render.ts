/**
 * Render an InfraGraph to Excalidraw JSON format
 */

import type { InfraGraph, ServiceNode, ServiceType } from "../graph/types"
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

export interface RenderOptions {
	nodeWidth?: number
	nodeHeight?: number
	horizontalGap?: number
	verticalGap?: number
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
