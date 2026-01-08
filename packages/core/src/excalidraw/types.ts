/**
 * Excalidraw JSON schema types
 * Based on https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/initialdata
 */

export type ExcalidrawElementType =
	| "rectangle"
	| "ellipse"
	| "diamond"
	| "text"
	| "arrow"
	| "line"
	| "freedraw"
	| "image"
	| "frame"

export type StrokeStyle = "solid" | "dashed" | "dotted"

export type FillStyle = "solid" | "hachure" | "cross-hatch"

export type TextAlign = "left" | "center" | "right"

export type VerticalAlign = "top" | "middle" | "bottom"

export type Arrowhead = "arrow" | "bar" | "dot" | "triangle" | null

export interface ExcalidrawElementBase {
	id: string
	type: ExcalidrawElementType
	x: number
	y: number
	width: number
	height: number
	angle: number
	strokeColor: string
	backgroundColor: string
	fillStyle: FillStyle
	strokeWidth: number
	strokeStyle: StrokeStyle
	roughness: number
	opacity: number
	groupIds: string[]
	frameId: string | null
	roundness: { type: number; value?: number } | null
	seed: number
	version: number
	versionNonce: number
	isDeleted: boolean
	boundElements: { id: string; type: "text" | "arrow" }[] | null
	updated: number
	link: string | null
	locked: boolean
}

export interface ExcalidrawRectangle extends ExcalidrawElementBase {
	type: "rectangle"
}

export interface ExcalidrawEllipse extends ExcalidrawElementBase {
	type: "ellipse"
}

export interface ExcalidrawDiamond extends ExcalidrawElementBase {
	type: "diamond"
}

export interface ExcalidrawText extends ExcalidrawElementBase {
	type: "text"
	text: string
	fontSize: number
	fontFamily: number
	textAlign: TextAlign
	verticalAlign: VerticalAlign
	baseline: number
	containerId: string | null
	originalText: string
	autoResize: boolean
	lineHeight: number
}

export interface Point {
	x: number
	y: number
}

export interface ExcalidrawArrow extends ExcalidrawElementBase {
	type: "arrow"
	points: [number, number][]
	startBinding: {
		elementId: string
		focus: number
		gap: number
	} | null
	endBinding: {
		elementId: string
		focus: number
		gap: number
	} | null
	startArrowhead: Arrowhead
	endArrowhead: Arrowhead
}

export interface ExcalidrawLine extends ExcalidrawElementBase {
	type: "line"
	points: [number, number][]
	startBinding: null
	endBinding: null
	startArrowhead: null
	endArrowhead: null
}

export interface ExcalidrawFrame extends ExcalidrawElementBase {
	type: "frame"
	name: string | null
}

export type ExcalidrawElement =
	| ExcalidrawRectangle
	| ExcalidrawEllipse
	| ExcalidrawDiamond
	| ExcalidrawText
	| ExcalidrawArrow
	| ExcalidrawLine
	| ExcalidrawFrame

export interface AppState {
	viewBackgroundColor: string
	gridSize: number | null
}

export interface ExcalidrawFile {
	type: "excalidraw"
	version: 2
	source: string
	elements: ExcalidrawElement[]
	appState: AppState
	files: Record<string, unknown>
}

// Color palette for different service types
export const SERVICE_COLORS = {
	database: {
		stroke: "#1971c2",
		background: "#a5d8ff",
	},
	cache: {
		stroke: "#e03131",
		background: "#ffc9c9",
	},
	queue: {
		stroke: "#f08c00",
		background: "#ffec99",
	},
	storage: {
		stroke: "#2f9e44",
		background: "#b2f2bb",
	},
	proxy: {
		stroke: "#7950f2",
		background: "#d0bfff",
	},
	container: {
		stroke: "#495057",
		background: "#dee2e6",
	},
	application: {
		stroke: "#0c8599",
		background: "#99e9f2",
	},
} as const

// Shape configuration for different service types
export const SERVICE_SHAPES: Record<string, ExcalidrawElementType> = {
	database: "ellipse",
	cache: "ellipse",
	queue: "diamond",
	storage: "rectangle",
	proxy: "rectangle",
	container: "rectangle",
	application: "rectangle",
} as const

// Default dimensions
export const LAYOUT_CONFIG = {
	nodeWidth: 180,
	nodeHeight: 80,
	horizontalGap: 100,
	verticalGap: 80,
	textPadding: 10,
	fontSize: 16,
	fontFamily: 1, // 1 = Virgil (hand-drawn), 2 = Helvetica, 3 = Cascadia
} as const
