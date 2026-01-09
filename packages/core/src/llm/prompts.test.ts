import { describe, expect, test } from "bun:test"
import type { InfraGraph } from "../graph/types"
import {
	type EnhancementResponse,
	applyEnhancements,
	buildEnhancePrompt,
} from "./prompts"

const createTestGraph = (): InfraGraph => ({
	nodes: [
		{
			id: "postgres",
			name: "postgres",
			type: "database",
			image: "postgres:15",
			ports: [{ internal: 5432 }],
			environment: { POSTGRES_PASSWORD: "secret" },
			source: { file: "docker-compose.yml", format: "docker-compose" },
		},
		{
			id: "redis",
			name: "redis",
			type: "cache",
			image: "redis:7",
			ports: [{ internal: 6379 }],
			source: { file: "docker-compose.yml", format: "docker-compose" },
		},
		{
			id: "api",
			name: "api",
			type: "application",
			image: "myapp/api:latest",
			ports: [{ internal: 3000, external: 3000 }],
			environment: {
				DATABASE_URL: "postgres://postgres:5432/db",
				REDIS_URL: "redis://redis:6379",
			},
			source: { file: "docker-compose.yml", format: "docker-compose" },
		},
		{
			id: "nginx",
			name: "nginx",
			type: "proxy",
			image: "nginx:latest",
			ports: [{ internal: 80, external: 80 }],
			source: { file: "docker-compose.yml", format: "docker-compose" },
		},
	],
	edges: [
		{ from: "api", to: "postgres", type: "depends_on" },
		{ from: "api", to: "redis", type: "depends_on" },
		{ from: "nginx", to: "api", type: "depends_on" },
	],
	metadata: {
		project: "test-project",
		parsedAt: new Date().toISOString(),
		sourceFiles: ["docker-compose.yml"],
		parserVersion: "0.1.0",
	},
})

describe("buildEnhancePrompt", () => {
	test("generates a prompt with all services", () => {
		const graph = createTestGraph()
		const prompt = buildEnhancePrompt(graph)

		// Check that all services are mentioned
		expect(prompt).toContain("postgres")
		expect(prompt).toContain("redis")
		expect(prompt).toContain("api")
		expect(prompt).toContain("nginx")
	})

	test("includes service details in the prompt", () => {
		const graph = createTestGraph()
		const prompt = buildEnhancePrompt(graph)

		// Check that service details are included
		expect(prompt).toContain("postgres:15")
		expect(prompt).toContain("5432")
		expect(prompt).toContain("redis:7")
	})

	test("includes dependencies in the prompt", () => {
		const graph = createTestGraph()
		const prompt = buildEnhancePrompt(graph)

		// Check that dependencies are mentioned
		expect(prompt).toContain("api -> postgres")
		expect(prompt).toContain("api -> redis")
		expect(prompt).toContain("nginx -> api")
	})

	test("handles graph with no edges", () => {
		const graph = createTestGraph()
		graph.edges = []
		const prompt = buildEnhancePrompt(graph)

		// Should handle gracefully
		expect(prompt).toContain("No explicit dependencies defined")
	})

	test("includes JSON format instructions", () => {
		const graph = createTestGraph()
		const prompt = buildEnhancePrompt(graph)

		// Should include format instructions
		expect(prompt).toContain("json")
		expect(prompt).toContain("services")
		expect(prompt).toContain("category")
		expect(prompt).toContain("description")
		expect(prompt).toContain("group")
	})
})

describe("applyEnhancements", () => {
	test("applies enhancements to matching nodes", () => {
		const graph = createTestGraph()
		const enhancements: EnhancementResponse = {
			services: [
				{
					id: "postgres",
					category: "data-layer",
					description: "Primary PostgreSQL database",
					group: "Data Stores",
				},
				{
					id: "redis",
					category: "data-layer",
					description: "Redis cache for session storage",
					group: "Data Stores",
				},
				{
					id: "api",
					category: "application-layer",
					description: "Main API server",
					group: "Application",
				},
				{
					id: "nginx",
					category: "infrastructure",
					description: "Reverse proxy and load balancer",
					group: "Infrastructure",
				},
			],
			groups: [
				{ name: "Data Stores", description: "Database and caching layer" },
				{ name: "Application", description: "Core application services" },
				{ name: "Infrastructure", description: "Supporting infrastructure" },
			],
		}

		const enhanced = applyEnhancements(graph, enhancements)

		// Check that enhancements were applied
		const postgresNode = enhanced.nodes.find((n) => n.id === "postgres")
		expect(postgresNode?.category).toBe("data-layer")
		expect(postgresNode?.description).toBe("Primary PostgreSQL database")
		expect(postgresNode?.group).toBe("Data Stores")

		const apiNode = enhanced.nodes.find((n) => n.id === "api")
		expect(apiNode?.category).toBe("application-layer")
		expect(apiNode?.group).toBe("Application")
	})

	test("preserves original properties", () => {
		const graph = createTestGraph()
		const enhancements: EnhancementResponse = {
			services: [
				{
					id: "postgres",
					category: "data-layer",
					description: "Database",
					group: "Data",
				},
			],
			groups: [],
		}

		const enhanced = applyEnhancements(graph, enhancements)
		const postgresNode = enhanced.nodes.find((n) => n.id === "postgres")

		// Original properties should be preserved
		expect(postgresNode?.name).toBe("postgres")
		expect(postgresNode?.type).toBe("database")
		expect(postgresNode?.image).toBe("postgres:15")
		expect(postgresNode?.ports?.[0]?.internal).toBe(5432)
	})

	test("handles partial enhancements", () => {
		const graph = createTestGraph()
		const enhancements: EnhancementResponse = {
			services: [
				{
					id: "postgres",
					category: "data-layer",
					description: "Database",
					group: "Data",
				},
				// Missing enhancements for other services
			],
			groups: [],
		}

		const enhanced = applyEnhancements(graph, enhancements)

		// Postgres should be enhanced
		const postgresNode = enhanced.nodes.find((n) => n.id === "postgres")
		expect(postgresNode?.category).toBe("data-layer")

		// Redis should not be enhanced (no category)
		const redisNode = enhanced.nodes.find((n) => n.id === "redis")
		expect(redisNode?.category).toBeUndefined()
	})

	test("preserves edges and metadata", () => {
		const graph = createTestGraph()
		const enhancements: EnhancementResponse = {
			services: [],
			groups: [],
		}

		const enhanced = applyEnhancements(graph, enhancements)

		// Edges should be unchanged
		expect(enhanced.edges).toEqual(graph.edges)

		// Metadata should be unchanged
		expect(enhanced.metadata).toEqual(graph.metadata)
	})
})
