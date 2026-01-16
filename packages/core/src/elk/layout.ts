/**
 * ELK layout runner
 *
 * Uses elkjs directly to compute graph layout positions.
 */

import ELK from "elkjs"
import type { ElkGraph } from "./types"

/**
 * Result of running ELK layout
 */
export interface ElkLayoutResult {
	/** The laid-out graph with x, y coordinates */
	graph: ElkGraph
	/** Total width of the layout */
	width: number
	/** Total height of the layout */
	height: number
}

/**
 * Run ELK layout on a graph
 */
export async function runLayout(graph: ElkGraph): Promise<ElkLayoutResult> {
	const elk = new ELK()
	const result = (await elk.layout(graph)) as ElkGraph

	return {
		graph: result,
		width: result.width ?? 0,
		height: result.height ?? 0,
	}
}
