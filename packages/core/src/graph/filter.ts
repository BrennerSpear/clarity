import type { InfraGraph, ServiceNode } from "./types"

export interface OrphanFilterResult {
	/** The filtered graph with orphans removed */
	graph: InfraGraph
	/** Nodes that were removed because they had no edges */
	orphans: ServiceNode[]
}

/**
 * Filters out orphan nodes (nodes with no incoming or outgoing edges)
 * Returns both the filtered graph and the list of orphaned nodes
 */
export function filterOrphanNodes(graph: InfraGraph): OrphanFilterResult {
	// Build a set of node IDs that appear in any edge
	const connectedNodeIds = new Set<string>()

	for (const edge of graph.edges) {
		connectedNodeIds.add(edge.from)
		connectedNodeIds.add(edge.to)
	}

	// Partition nodes into connected and orphans
	const connectedNodes: ServiceNode[] = []
	const orphans: ServiceNode[] = []

	for (const node of graph.nodes) {
		if (connectedNodeIds.has(node.id)) {
			connectedNodes.push(node)
		} else {
			orphans.push(node)
		}
	}

	return {
		graph: {
			...graph,
			nodes: connectedNodes,
		},
		orphans,
	}
}
