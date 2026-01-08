import type {
	DependencyEdge,
	DependencyType,
	InfraGraph,
	ServiceNode,
	ServiceType,
	SourceFormat,
} from "./types"

export class GraphBuilder {
	private nodes: Map<string, ServiceNode> = new Map()
	private edges: DependencyEdge[] = []
	private sourceFiles: string[] = []
	private project: string

	constructor(project: string) {
		this.project = project
	}

	addSourceFile(file: string): this {
		if (!this.sourceFiles.includes(file)) {
			this.sourceFiles.push(file)
		}
		return this
	}

	addNode(
		id: string,
		name: string,
		type: ServiceType,
		source: { file: string; format: SourceFormat; line?: number },
		options?: Partial<Omit<ServiceNode, "id" | "name" | "type" | "source">>,
	): this {
		this.nodes.set(id, {
			id,
			name,
			type,
			source,
			...options,
		})
		return this
	}

	addEdge(
		from: string,
		to: string,
		type: DependencyType,
		options?: { port?: number; protocol?: string },
	): this {
		// Only add edge if both nodes exist
		if (this.nodes.has(from) && this.nodes.has(to)) {
			// Check if any edge already exists between these nodes
			const existingEdge = this.edges.find(
				(e) => e.from === from && e.to === to,
			)

			// Skip inferred edges if any explicit edge already exists
			if (type === "inferred" && existingEdge) {
				return this
			}

			// Avoid duplicate edges with same from, to, AND type
			const duplicateExists = this.edges.some(
				(e) => e.from === from && e.to === to && e.type === type,
			)
			if (duplicateExists) {
				return this
			}

			this.edges.push({
				from,
				to,
				type,
				...options,
			})
		}
		return this
	}

	hasNode(id: string): boolean {
		return this.nodes.has(id)
	}

	getNode(id: string): ServiceNode | undefined {
		return this.nodes.get(id)
	}

	build(): InfraGraph {
		return {
			nodes: Array.from(this.nodes.values()),
			edges: this.edges,
			metadata: {
				project: this.project,
				parsedAt: new Date().toISOString(),
				sourceFiles: this.sourceFiles,
				parserVersion: "0.1.0",
			},
		}
	}
}
