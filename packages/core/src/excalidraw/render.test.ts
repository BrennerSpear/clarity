import { describe, expect, test } from "bun:test"
import type { InfraGraph } from "../graph/types"
import { calculateLayout } from "./layout"
import { renderToExcalidraw } from "./render"

const createTestGraph = (
	nodes: number,
	edges: [number, number][] = [],
): InfraGraph => ({
	nodes: Array.from({ length: nodes }, (_, i) => ({
		id: `node-${i}`,
		name: `Service ${i}`,
		type: "container" as const,
		source: { file: "test.yml", format: "docker-compose" as const },
	})),
	edges: edges.map(([from, to]) => ({
		from: `node-${from}`,
		to: `node-${to}`,
		type: "depends_on" as const,
	})),
	metadata: {
		project: "test",
		parsedAt: new Date().toISOString(),
		sourceFiles: ["test.yml"],
		parserVersion: "0.1.0",
	},
})

describe("calculateLayout", () => {
	test("handles empty graph", () => {
		const graph = createTestGraph(0)
		const layout = calculateLayout(graph)

		expect(layout.positions.size).toBe(0)
		expect(layout.width).toBe(0)
		expect(layout.height).toBe(0)
	})

	test("positions single node", () => {
		const graph = createTestGraph(1)
		const layout = calculateLayout(graph)

		expect(layout.positions.size).toBe(1)
		const pos = layout.positions.get("node-0")
		expect(pos).toBeDefined()
		expect(pos?.layer).toBe(0)
	})

	test("creates layers based on dependencies", () => {
		// node-0 depends on node-1 (node-1 should be at layer 0, node-0 at layer 1)
		const graph = createTestGraph(2, [[0, 1]])
		const layout = calculateLayout(graph)

		expect(layout.positions.size).toBe(2)

		const pos0 = layout.positions.get("node-0")
		const pos1 = layout.positions.get("node-1")

		expect(pos0?.layer).toBe(1)
		expect(pos1?.layer).toBe(0)

		// node-0 should be above node-1 (lower y value since we invert layers)
		expect(pos0?.y).toBeLessThan(pos1?.y)
	})

	test("handles chain of dependencies", () => {
		// node-0 -> node-1 -> node-2
		const graph = createTestGraph(3, [
			[0, 1],
			[1, 2],
		])
		const layout = calculateLayout(graph)

		const pos0 = layout.positions.get("node-0")
		const pos1 = layout.positions.get("node-1")
		const pos2 = layout.positions.get("node-2")

		expect(pos0?.layer).toBe(2)
		expect(pos1?.layer).toBe(1)
		expect(pos2?.layer).toBe(0)
	})

	test("handles multiple nodes at same layer", () => {
		// node-0 and node-1 both depend on node-2
		const graph = createTestGraph(3, [
			[0, 2],
			[1, 2],
		])
		const layout = calculateLayout(graph)

		const pos0 = layout.positions.get("node-0")
		const pos1 = layout.positions.get("node-1")
		const pos2 = layout.positions.get("node-2")

		expect(pos0?.layer).toBe(1)
		expect(pos1?.layer).toBe(1)
		expect(pos2?.layer).toBe(0)

		// pos0 and pos1 should be on the same y level
		expect(pos0?.y).toBe(pos1?.y)
	})
})

describe("renderToExcalidraw", () => {
	test("handles empty graph", () => {
		const graph = createTestGraph(0)
		const result = renderToExcalidraw(graph)

		expect(result.type).toBe("excalidraw")
		expect(result.version).toBe(2)
		expect(result.source).toBe("clarity")
		expect(result.elements).toHaveLength(0)
	})

	test("creates shape and text for each node", () => {
		const graph = createTestGraph(2)
		const result = renderToExcalidraw(graph)

		// Each node should have a shape and a text element
		expect(result.elements).toHaveLength(4)

		const shapes = result.elements.filter(
			(e) =>
				e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond",
		)
		const texts = result.elements.filter((e) => e.type === "text")

		expect(shapes).toHaveLength(2)
		expect(texts).toHaveLength(2)
	})

	test("creates arrows for edges", () => {
		const graph = createTestGraph(2, [[0, 1]])
		const result = renderToExcalidraw(graph)

		const arrows = result.elements.filter((e) => e.type === "arrow")
		expect(arrows).toHaveLength(1)

		const arrow = arrows[0]
		expect(arrow).toBeDefined()
		if (arrow?.type === "arrow") {
			expect(arrow.startBinding?.elementId).toBe("shape-node-0")
			expect(arrow.endBinding?.elementId).toBe("shape-node-1")
		}
	})

	test("uses correct shape for database", () => {
		const graph: InfraGraph = {
			nodes: [
				{
					id: "db",
					name: "postgres",
					type: "database",
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

		const result = renderToExcalidraw(graph)
		const shapes = result.elements.filter((e) => e.type === "ellipse")

		expect(shapes).toHaveLength(1)
	})

	test("uses correct shape for queue", () => {
		const graph: InfraGraph = {
			nodes: [
				{
					id: "queue",
					name: "rabbitmq",
					type: "queue",
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

		const result = renderToExcalidraw(graph)
		const shapes = result.elements.filter((e) => e.type === "diamond")

		expect(shapes).toHaveLength(1)
	})

	test("binds text to shape", () => {
		const graph = createTestGraph(1)
		const result = renderToExcalidraw(graph)

		const shape = result.elements.find(
			(e) =>
				e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond",
		)
		const text = result.elements.find((e) => e.type === "text")

		expect(shape?.boundElements).toContainEqual({ id: text?.id, type: "text" })
		if (text?.type === "text") {
			expect(text.containerId).toBe(shape?.id)
		}
	})

	test("sets correct colors for different service types", () => {
		const graph: InfraGraph = {
			nodes: [
				{
					id: "db",
					name: "postgres",
					type: "database",
					source: { file: "test.yml", format: "docker-compose" },
				},
				{
					id: "cache",
					name: "redis",
					type: "cache",
					source: { file: "test.yml", format: "docker-compose" },
				},
				{
					id: "app",
					name: "api",
					type: "container",
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

		const result = renderToExcalidraw(graph)
		const shapes = result.elements.filter(
			(e) =>
				e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond",
		)

		// Each type should have different colors
		const colors = new Set(shapes.map((s) => s.backgroundColor))
		expect(colors.size).toBe(3)
	})

	test("produces valid Excalidraw file structure", () => {
		const graph = createTestGraph(3, [
			[0, 1],
			[1, 2],
		])
		const result = renderToExcalidraw(graph)

		expect(result.type).toBe("excalidraw")
		expect(result.version).toBe(2)
		expect(result.appState).toHaveProperty("viewBackgroundColor")
		expect(result.files).toBeDefined()

		// Check that all elements have required properties
		for (const element of result.elements) {
			expect(element.id).toBeTruthy()
			expect(element.type).toBeTruthy()
			expect(typeof element.x).toBe("number")
			expect(typeof element.y).toBe("number")
			expect(typeof element.width).toBe("number")
			expect(typeof element.height).toBe("number")
		}
	})
})
