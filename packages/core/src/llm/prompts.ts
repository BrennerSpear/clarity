/**
 * LLM prompts for enhancing infrastructure graphs
 */

import type { InfraGraph, ServiceCategory, ServiceNode } from "../graph/types"

/**
 * Service enhancement data returned by the LLM
 */
export interface ServiceEnhancement {
	id: string
	category: ServiceCategory
	description: string
	group: string
}

/**
 * Full enhancement response from the LLM
 */
export interface EnhancementResponse {
	services: ServiceEnhancement[]
	groups: {
		name: string
		description: string
	}[]
}

/**
 * Build the prompt for enhancing an infrastructure graph
 */
export function buildEnhancePrompt(graph: InfraGraph): string {
	const servicesInfo = graph.nodes
		.map((node) => formatServiceInfo(node))
		.join("\n\n")

	const edgesInfo = graph.edges
		.map((edge) => `- ${edge.from} -> ${edge.to} (${edge.type})`)
		.join("\n")

	return `You are an infrastructure architect analyzing a system to create clear, informative architecture diagrams.

## Task
Analyze the following infrastructure services and enhance each with:
1. A category (for grouping in diagrams)
2. A brief description (what it does)
3. A logical group name (for visual grouping)

## Categories
Choose ONE category per service:
- "data-layer" - Databases, caches, object storage, message queues
- "application-layer" - Application servers, APIs, web servers, workers
- "infrastructure" - Proxies, load balancers, service mesh, DNS
- "monitoring" - Metrics, logging, tracing, alerting
- "security" - Authentication, secrets management, firewalls

## Services to Analyze

${servicesInfo}

## Dependencies
${edgesInfo || "No explicit dependencies defined"}

## Response Format
Return ONLY valid JSON matching this structure:
\`\`\`json
{
  "services": [
    {
      "id": "service-id",
      "category": "data-layer",
      "description": "Brief description of what this service does",
      "group": "Group Name"
    }
  ],
  "groups": [
    {
      "name": "Group Name",
      "description": "Brief description of this logical group"
    }
  ]
}
\`\`\`

## Guidelines
- Keep descriptions under 50 words
- Group related services together (e.g., all databases in "Data Stores")
- Use clear, non-technical group names suitable for architecture diagrams
- Infer purpose from service name, image, ports, and environment variables
- Create 3-5 groups for typical infrastructure (avoid too many or too few)`
}

/**
 * Format a service node for the prompt
 */
function formatServiceInfo(node: ServiceNode): string {
	const lines = [`### ${node.name} (id: ${node.id})`]

	if (node.image) {
		lines.push(`- Image: ${node.image}`)
	}

	lines.push(`- Type: ${node.type}`)

	if (node.ports?.length) {
		const ports = node.ports
			.map((p) => `${p.external ?? "?"}:${p.internal}`)
			.join(", ")
		lines.push(`- Ports: ${ports}`)
	}

	if (node.environment && Object.keys(node.environment).length > 0) {
		const envKeys = Object.keys(node.environment).slice(0, 10).join(", ")
		lines.push(
			`- Environment: ${envKeys}${Object.keys(node.environment).length > 10 ? "..." : ""}`,
		)
	}

	if (node.volumes?.length) {
		const volumes = node.volumes
			.slice(0, 3)
			.map((v) => `${v.source}:${v.target}`)
			.join(", ")
		lines.push(`- Volumes: ${volumes}${node.volumes.length > 3 ? "..." : ""}`)
	}

	return lines.join("\n")
}

/**
 * Apply enhancements to the graph
 */
export function applyEnhancements(
	graph: InfraGraph,
	enhancements: EnhancementResponse,
): InfraGraph {
	const enhancementMap = new Map(enhancements.services.map((s) => [s.id, s]))

	const enhancedNodes = graph.nodes.map((node) => {
		const enhancement = enhancementMap.get(node.id)
		if (enhancement) {
			return {
				...node,
				category: enhancement.category,
				description: enhancement.description,
				group: enhancement.group,
			}
		}
		return node
	})

	return {
		...graph,
		nodes: enhancedNodes,
	}
}
