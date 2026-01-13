/**
 * ELK (Eclipse Layout Kernel) graph types
 * Re-export from elkjs and add custom types
 */

// Re-export elkjs types from bundled version
export type {
	ElkNode,
	ElkPort,
	ElkLabel,
	ElkExtendedEdge as ElkEdge,
	ElkEdgeSection,
	ElkPoint,
	LayoutOptions,
} from "elkjs/lib/elk-api"

import type { ElkNode } from "elkjs/lib/elk-api"

/**
 * Root graph (just an ElkNode with id="root")
 */
export type ElkGraph = ElkNode & { id: "root" }

/**
 * Semantic layer assignment for left-to-right flow
 */
export type SemanticLayer = "entry" | "ui" | "api" | "worker" | "queue" | "data"

/**
 * Layer configuration for ELK partitioning
 */
export interface LayerConfig {
	/** Partition number (0 = leftmost) */
	partition: number
	/** Layer name for debugging */
	name: SemanticLayer
}

/**
 * Result of converting InfraGraph to ELK format
 */
export interface ElkConversionResult {
	/** The ELK graph ready for layout */
	graph: ElkGraph
	/** Mapping of node IDs to their assigned layers */
	layerAssignments: Map<string, SemanticLayer>
}

/**
 * Layout options presets
 */
export const ELK_LAYOUT_OPTIONS = {
	/** Standard left-to-right layered layout */
	standard: {
		"elk.algorithm": "layered",
		"elk.direction": "RIGHT",
		"elk.edgeRouting": "ORTHOGONAL",
		"elk.spacing.nodeNode": "50",
		"elk.layered.spacing.nodeNodeBetweenLayers": "80",
		"elk.layered.mergeEdges": "false",
	},
	/** Semantic partitioning enabled */
	semantic: {
		"elk.algorithm": "layered",
		"elk.direction": "RIGHT",
		"elk.edgeRouting": "ORTHOGONAL",
		"elk.spacing.nodeNode": "50",
		"elk.layered.spacing.nodeNodeBetweenLayers": "80",
		"elk.layered.mergeEdges": "false",
		"elk.partitioning.activate": "true",
	},
	/** Compound node (for grouping related services) */
	compound: {
		"elk.algorithm": "layered",
		"elk.direction": "DOWN",
		"elk.edgeRouting": "ORTHOGONAL",
		"elk.spacing.nodeNode": "20",
		"elk.layered.spacing.nodeNodeBetweenLayers": "30",
		"elk.hierarchyHandling": "INCLUDE_CHILDREN",
	},
} as const
