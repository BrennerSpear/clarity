import { z } from "zod"

export const PortMappingSchema = z.object({
	internal: z.number(),
	external: z.number().optional(),
})

export const VolumeMountSchema = z.object({
	source: z.string(),
	target: z.string(),
	type: z.enum(["volume", "bind", "tmpfs"]).optional(),
})

export const SourceInfoSchema = z.object({
	file: z.string(),
	format: z.enum(["docker-compose", "helm", "terraform", "ansible"]),
	line: z.number().optional(),
})

export const ServiceNodeSchema = z.object({
	id: z.string().min(1),
	name: z.string(),
	type: z.enum([
		"container",
		"database",
		"cache",
		"queue",
		"storage",
		"proxy",
		"ui",
	]),
	source: SourceInfoSchema,
	image: z.string().optional(),
	ports: z.array(PortMappingSchema).optional(),
	volumes: z.array(VolumeMountSchema).optional(),
	// Environment values can be strings, numbers, booleans, or null (pass-through from host)
	environment: z
		.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
		.optional(),
	replicas: z.number().optional(),
	resourceRequests: z
		.object({
			cpu: z.string().optional(),
			memory: z.string().optional(),
		})
		.optional(),
	storageSize: z.string().optional(),
	external: z.boolean().optional(),
	description: z.string().optional(),
	group: z.string().optional(),
	queueRole: z.enum(["producer", "consumer", "both"]).optional(),
})

export const DependencyEdgeSchema = z.object({
	from: z.string(),
	to: z.string(),
	type: z.enum([
		"depends_on",
		"network",
		"volume",
		"link",
		"inferred",
		"subchart",
	]),
	port: z.number().optional(),
	protocol: z.string().optional(),
})

export const GraphMetadataSchema = z.object({
	project: z.string(),
	parsedAt: z.string().datetime(),
	sourceFiles: z.array(z.string()),
	parserVersion: z.string(),
})

export const InfraGraphSchema = z
	.object({
		nodes: z.array(ServiceNodeSchema),
		edges: z.array(DependencyEdgeSchema),
		metadata: GraphMetadataSchema,
	})
	.refine(
		(graph) => {
			const nodeIds = new Set(graph.nodes.map((n) => n.id))
			return graph.edges.every((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
		},
		{ message: "Edge references non-existent node" },
	)
	.refine(
		(graph) => {
			const ids = graph.nodes.map((n) => n.id)
			return new Set(ids).size === ids.length
		},
		{ message: "Duplicate node IDs detected" },
	)

// Type inference from schema
export type ValidatedServiceNode = z.infer<typeof ServiceNodeSchema>
export type ValidatedDependencyEdge = z.infer<typeof DependencyEdgeSchema>
export type ValidatedInfraGraph = z.infer<typeof InfraGraphSchema>
