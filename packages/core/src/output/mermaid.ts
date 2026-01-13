/**
 * Mermaid diagram generation for debug output
 */

import type { InfraGraph, ServiceNode, ServiceType } from "../graph/types"

/**
 * Get Mermaid shape syntax for a service type
 */
function getNodeShape(type: ServiceType): { open: string; close: string } {
	switch (type) {
		case "database":
			return { open: "[(", close: ")]" }
		case "cache":
			return { open: "((", close: "))" }
		case "queue":
			return { open: "[/", close: "/]" }
		case "storage":
			return { open: "[(", close: ")]" }
		default:
			return { open: "[", close: "]" }
	}
}

/**
 * Escape special characters in Mermaid labels
 */
function escapeLabel(label: string): string {
	return label
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
}

/**
 * Group nodes by category
 */
function groupByCategory(nodes: ServiceNode[]): Record<string, ServiceNode[]> {
	const groups: Record<string, ServiceNode[]> = {}

	for (const node of nodes) {
		const category = node.category ?? "ungrouped"
		if (!groups[category]) {
			groups[category] = []
		}
		groups[category].push(node)
	}

	return groups
}

/**
 * Format category name for display
 */
function formatCategoryName(category: string): string {
	if (category === "ungrouped") {
		return "Other"
	}
	return category
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")
}

/**
 * Convert an InfraGraph to Mermaid flowchart syntax
 */
export function graphToMermaid(graph: InfraGraph): string {
	const lines: string[] = ["flowchart TB"]

	// Group nodes by category if available
	const grouped = groupByCategory(graph.nodes)

	for (const [category, nodes] of Object.entries(grouped)) {
		if (category !== "ungrouped") {
			const categoryLabel = formatCategoryName(category)
			lines.push(`  subgraph ${categoryLabel}`)
		}

		for (const node of nodes) {
			const shape = getNodeShape(node.type)
			const label = escapeLabel(node.name)
			const indent = category !== "ungrouped" ? "    " : "  "
			lines.push(`${indent}${node.id}${shape.open}"${label}"${shape.close}`)
		}

		if (category !== "ungrouped") {
			lines.push("  end")
		}
	}

	// Add edges
	for (const edge of graph.edges) {
		const label = edge.port ? `|:${edge.port}|` : ""
		lines.push(`  ${edge.from} -->${label} ${edge.to}`)
	}

	return lines.join("\n")
}

/**
 * Convert an InfraGraph to Mermaid with styling
 */
export function graphToMermaidStyled(graph: InfraGraph): string {
	const baseDiagram = graphToMermaid(graph)
	const lines = baseDiagram.split("\n")

	// Add styling based on service types
	const styleLines: string[] = []

	for (const node of graph.nodes) {
		const styleClass = getStyleClass(node.type)
		if (styleClass) {
			styleLines.push(`  class ${node.id} ${styleClass}`)
		}
	}

	// Add class definitions
	if (styleLines.length > 0) {
		lines.push("")
		lines.push("  %% Style definitions")
		lines.push("  classDef database fill:#a5d8ff,stroke:#1971c2")
		lines.push("  classDef cache fill:#ffd43b,stroke:#fab005")
		lines.push("  classDef queue fill:#d0bfff,stroke:#7950f2")
		lines.push("  classDef storage fill:#b2f2bb,stroke:#2f9e44")
		lines.push("  classDef proxy fill:#ffc9c9,stroke:#e03131")
		lines.push("  classDef application fill:#99e9f2,stroke:#0c8599")
		lines.push("")
		lines.push(...styleLines)
	}

	return lines.join("\n")
}

/**
 * Get style class name for a service type
 */
function getStyleClass(type: ServiceType): string | null {
	switch (type) {
		case "database":
			return "database"
		case "cache":
			return "cache"
		case "queue":
			return "queue"
		case "storage":
			return "storage"
		case "proxy":
			return "proxy"
		case "application":
			return "application"
		default:
			return null
	}
}
