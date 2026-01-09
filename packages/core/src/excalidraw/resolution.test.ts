import { describe, expect, test } from "bun:test"
import type { InfraGraph } from "../graph/types"
import { renderAllResolutions, renderAtResolution } from "./render"

const createEnhancedGraph = (): InfraGraph => ({
	nodes: [
		{
			id: "postgres",
			name: "postgres",
			type: "database",
			category: "data-layer",
			group: "Data Stores",
			source: { file: "docker-compose.yml", format: "docker-compose" },
		},
		{
			id: "redis",
			name: "redis",
			type: "cache",
			category: "data-layer",
			group: "Data Stores",
			source: { file: "docker-compose.yml", format: "docker-compose" },
		},
		{
			id: "api",
			name: "api",
			type: "application",
			category: "application-layer",
			group: "Application",
			source: { file: "docker-compose.yml", format: "docker-compose" },
		},
		{
			id: "worker",
			name: "worker",
			type: "application",
			category: "application-layer",
			group: "Application",
			source: { file: "docker-compose.yml", format: "docker-compose" },
		},
		{
			id: "nginx",
			name: "nginx",
			type: "proxy",
			category: "infrastructure",
			group: "Infrastructure",
			source: { file: "docker-compose.yml", format: "docker-compose" },
		},
	],
	edges: [
		{ from: "api", to: "postgres", type: "depends_on" },
		{ from: "api", to: "redis", type: "depends_on" },
		{ from: "worker", to: "postgres", type: "depends_on" },
		{ from: "worker", to: "redis", type: "depends_on" },
		{ from: "nginx", to: "api", type: "depends_on" },
	],
	metadata: {
		project: "test-project",
		parsedAt: new Date().toISOString(),
		sourceFiles: ["docker-compose.yml"],
		parserVersion: "0.1.0",
	},
})

describe("renderAtResolution", () => {
	test("executive resolution creates category-based nodes", () => {
		const graph = createEnhancedGraph()
		const result = renderAtResolution(graph, "executive")

		// Should have elements for each category
		// 3 categories: data-layer, application-layer, infrastructure
		// Each category has shape + text = 6 total nodes elements
		// Plus edges between categories
		expect(result.elements.length).toBeGreaterThan(0)

		// Find the shapes (rectangles, ellipses, diamonds)
		const shapes = result.elements.filter(
			(e) =>
				e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond",
		)
		expect(shapes.length).toBe(3) // 3 categories

		// Find text elements with category names
		const texts = result.elements.filter((e) => e.type === "text")
		expect(texts.length).toBe(3)

		// Check that text contains service counts
		const textContents = texts.map((t) => (t.type === "text" ? t.text : ""))
		expect(textContents.some((t) => t.includes("2 services"))).toBe(true) // data-layer and application-layer
	})

	test("groups resolution creates group-based nodes", () => {
		const graph = createEnhancedGraph()
		const result = renderAtResolution(graph, "groups")

		// Should have elements for each group
		// 3 groups: Data Stores, Application, Infrastructure
		const shapes = result.elements.filter(
			(e) =>
				e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond",
		)
		expect(shapes.length).toBe(3)

		const texts = result.elements.filter((e) => e.type === "text")
		expect(texts.length).toBe(3)

		// Check that text contains group names
		const textContents = texts.map((t) => (t.type === "text" ? t.text : ""))
		expect(textContents.some((t) => t.includes("Data Stores"))).toBe(true)
		expect(textContents.some((t) => t.includes("Application"))).toBe(true)
	})

	test("services resolution renders all individual services", () => {
		const graph = createEnhancedGraph()
		const result = renderAtResolution(graph, "services")

		// Should have shape+text for each service
		const shapes = result.elements.filter(
			(e) =>
				e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond",
		)
		expect(shapes.length).toBe(5) // 5 services

		// Should have arrows for edges
		const arrows = result.elements.filter((e) => e.type === "arrow")
		expect(arrows.length).toBe(5) // 5 edges
	})

	test("detailed resolution includes all services", () => {
		const graph = createEnhancedGraph()
		const result = renderAtResolution(graph, "detailed")

		// Similar to services but potentially with larger nodes
		const shapes = result.elements.filter(
			(e) =>
				e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond",
		)
		expect(shapes.length).toBe(5)
	})
})

describe("renderAllResolutions", () => {
	test("renders multiple resolution levels", () => {
		const graph = createEnhancedGraph()
		const results = renderAllResolutions(graph, [
			"executive",
			"groups",
			"services",
		])

		expect(results.size).toBe(3)
		expect(results.has("executive")).toBe(true)
		expect(results.has("groups")).toBe(true)
		expect(results.has("services")).toBe(true)
	})

	test("each resolution produces valid Excalidraw files", () => {
		const graph = createEnhancedGraph()
		const results = renderAllResolutions(graph)

		for (const [level, file] of results) {
			expect(file.type).toBe("excalidraw")
			expect(file.version).toBe(2)
			expect(file.source).toBe("clarity")
			expect(file.elements.length).toBeGreaterThan(0)
		}
	})

	test("default resolutions are executive, groups, services", () => {
		const graph = createEnhancedGraph()
		const results = renderAllResolutions(graph)

		expect(results.size).toBe(3)
		expect(results.has("executive")).toBe(true)
		expect(results.has("groups")).toBe(true)
		expect(results.has("services")).toBe(true)
	})
})

describe("edge handling in resolution views", () => {
	test("executive view creates inter-category edges", () => {
		const graph = createEnhancedGraph()
		const result = renderAtResolution(graph, "executive")

		const arrows = result.elements.filter((e) => e.type === "arrow")
		// Should have edges between categories:
		// application-layer -> data-layer
		// infrastructure -> application-layer
		expect(arrows.length).toBe(2)
	})

	test("groups view creates inter-group edges", () => {
		const graph = createEnhancedGraph()
		const result = renderAtResolution(graph, "groups")

		const arrows = result.elements.filter((e) => e.type === "arrow")
		// Should have edges between groups:
		// Application -> Data Stores
		// Infrastructure -> Application
		expect(arrows.length).toBe(2)
	})

	test("no self-edges within categories", () => {
		const graph = createEnhancedGraph()
		const result = renderAtResolution(graph, "executive")

		// Check that no arrow connects to itself
		for (const element of result.elements) {
			if (element.type === "arrow") {
				const startId = element.startBinding?.elementId
				const endId = element.endBinding?.elementId
				expect(startId).not.toBe(endId)
			}
		}
	})
})

describe("handling ungrouped nodes", () => {
	test("nodes without category go to ungrouped", () => {
		const graph: InfraGraph = {
			nodes: [
				{
					id: "service1",
					name: "service1",
					type: "container",
					// No category
					source: { file: "test.yml", format: "docker-compose" },
				},
			],
			edges: [],
			metadata: {
				project: "test",
				parsedAt: new Date().toISOString(),
				sourceFiles: ["test.yml"],
				parserVersion: "0.1.0",
			},
		}

		const result = renderAtResolution(graph, "executive")

		const texts = result.elements.filter((e) => e.type === "text")
		const textContents = texts.map((t) => (t.type === "text" ? t.text : ""))
		expect(textContents.some((t) => t.includes("Other Services"))).toBe(true)
	})

	test("nodes without group go to Other", () => {
		const graph: InfraGraph = {
			nodes: [
				{
					id: "service1",
					name: "service1",
					type: "container",
					category: "application-layer",
					// No group
					source: { file: "test.yml", format: "docker-compose" },
				},
			],
			edges: [],
			metadata: {
				project: "test",
				parsedAt: new Date().toISOString(),
				sourceFiles: ["test.yml"],
				parserVersion: "0.1.0",
			},
		}

		const result = renderAtResolution(graph, "groups")

		const texts = result.elements.filter((e) => e.type === "text")
		const textContents = texts.map((t) => (t.type === "text" ? t.text : ""))
		expect(textContents.some((t) => t.includes("Other"))).toBe(true)
	})
})
