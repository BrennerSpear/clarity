import { describe, expect, test } from "bun:test"
import type { InfraGraph } from "../graph/types"
import { infraGraphToElk, summarizeLayers } from "./convert"
import { runLayout } from "./layout"

const mockGraph: InfraGraph = {
	nodes: [
		{
			id: "nginx",
			name: "nginx",
			type: "proxy",
			source: { file: "test.yml", format: "docker-compose" },
		},
		{
			id: "web",
			name: "web",
			type: "ui",
			source: { file: "test.yml", format: "docker-compose" },
		},
		{
			id: "postgres",
			name: "postgres",
			type: "database",
			source: { file: "test.yml", format: "docker-compose" },
		},
	],
	edges: [
		{ from: "nginx", to: "web", type: "depends_on" },
		{ from: "web", to: "postgres", type: "depends_on" },
	],
	metadata: {
		project: "test",
		parsedAt: new Date().toISOString(),
		sourceFiles: ["test.yml"],
		parserVersion: "0.1.0",
	},
}

describe("ELK layout", () => {
	test("infraGraphToElk converts graph with semantic layers", () => {
		const result = infraGraphToElk(mockGraph)

		// Check layer assignments
		const layers = summarizeLayers(result.layerAssignments)
		expect(layers.entry).toEqual(["nginx"])
		expect(layers.ui).toEqual(["web"])
		expect(layers.data).toEqual(["postgres"])

		// Check graph structure
		expect(result.graph.id).toBe("root")
		expect(result.graph.children?.length).toBe(3)
		expect(result.graph.edges?.length).toBe(2)
	})

	test("runLayout computes positions", async () => {
		const { graph } = infraGraphToElk(mockGraph)
		const result = await runLayout(graph)

		// Check that layout produced dimensions
		expect(result.width).toBeGreaterThan(0)
		expect(result.height).toBeGreaterThan(0)

		// Check that nodes have positions
		for (const child of result.graph.children ?? []) {
			expect(child.x).toBeDefined()
			expect(child.y).toBeDefined()
		}
	})
})
