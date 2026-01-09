import { describe, expect, test } from "bun:test"
import type { InfraGraph } from "../graph/types"
import { createClient, parseJsonResponse, sendMessage } from "./client"
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

describe("LLM Enhancement Integration", () => {
	test("enhances a graph with real Claude API call", async () => {
		const graph = createTestGraph()
		const client = createClient()

		// Build prompt and send to Claude
		const prompt = buildEnhancePrompt(graph)
		const response = await sendMessage(client, prompt, {
			model: "claude-sonnet-4-20250514",
		})

		// Parse the response using our parser
		const enhancements = parseJsonResponse<EnhancementResponse>(response)

		// Verify structure
		expect(enhancements.services).toBeDefined()
		expect(Array.isArray(enhancements.services)).toBe(true)
		expect(enhancements.services.length).toBe(4) // All 4 services

		// Verify each service has required fields
		for (const service of enhancements.services) {
			expect(service.id).toBeTruthy()
			expect(service.category).toBeTruthy()
			expect(service.description).toBeTruthy()
			expect(service.group).toBeTruthy()

			// Verify category is valid
			expect([
				"data-layer",
				"application-layer",
				"infrastructure",
				"monitoring",
				"security",
			]).toContain(service.category)
		}

		// Verify groups are defined
		expect(enhancements.groups).toBeDefined()
		expect(Array.isArray(enhancements.groups)).toBe(true)
		expect(enhancements.groups.length).toBeGreaterThan(0)

		// Apply enhancements and verify
		const enhancedGraph = applyEnhancements(graph, enhancements)

		// ========================================
		// QUALITY CHECKS - Verify correct categorizations
		// These are assertions about known-correct categorizations
		// that any competent LLM should get right
		// ========================================

		// Databases should ALWAYS be data-layer
		const postgresNode = enhancedGraph.nodes.find((n) => n.id === "postgres")
		expect(postgresNode?.category).toBe("data-layer")
		expect(postgresNode?.description).toBeTruthy()
		expect(postgresNode?.description?.toLowerCase()).toMatch(
			/database|postgres|sql|storage/,
		)

		// Caches should ALWAYS be data-layer
		const redisNode = enhancedGraph.nodes.find((n) => n.id === "redis")
		expect(redisNode?.category).toBe("data-layer")
		expect(redisNode?.description?.toLowerCase()).toMatch(
			/cache|redis|memory|store/,
		)

		// Application servers should be application-layer
		const apiNode = enhancedGraph.nodes.find((n) => n.id === "api")
		expect(apiNode?.category).toBe("application-layer")
		expect(apiNode?.description?.toLowerCase()).toMatch(
			/api|server|application/,
		)

		// Reverse proxies/load balancers should be infrastructure
		const nginxNode = enhancedGraph.nodes.find((n) => n.id === "nginx")
		expect(nginxNode?.category).toBe("infrastructure")
		expect(nginxNode?.description?.toLowerCase()).toMatch(
			/proxy|load|balancer|nginx|gateway/,
		)

		// Verify grouping makes sense - data services should be grouped together
		expect(postgresNode?.group).toBe(redisNode?.group)

		// Application and infrastructure should NOT be in the same group as data
		expect(apiNode?.group).not.toBe(postgresNode?.group)
		expect(nginxNode?.group).not.toBe(postgresNode?.group)
	}, 30000) // 30 second timeout for API call
})
