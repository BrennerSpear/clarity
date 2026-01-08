import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { InfraGraph } from "../graph/types"
import { renderToExcalidraw } from "./render"
import { isValidExcalidraw, validateExcalidraw } from "./validate"

describe("validateExcalidraw", () => {
	test("validates minimal valid file", () => {
		const file = {
			type: "excalidraw",
			version: 2,
			source: "test",
			elements: [],
			appState: { viewBackgroundColor: "#ffffff", gridSize: null },
			files: {},
		}

		const result = validateExcalidraw(file)
		expect(result.valid).toBe(true)
		expect(result.errors).toHaveLength(0)
	})

	test("rejects non-object input", () => {
		const result = validateExcalidraw("not an object")
		expect(result.valid).toBe(false)
		expect(result.errors).toContain("Input is not an object")
	})

	test("rejects missing type field", () => {
		const file = {
			version: 2,
			elements: [],
			appState: {},
		}

		const result = validateExcalidraw(file)
		expect(result.valid).toBe(false)
		expect(result.errors.some((e) => e.includes("type"))).toBe(true)
	})

	test("rejects missing elements array", () => {
		const file = {
			type: "excalidraw",
			version: 2,
			appState: {},
		}

		const result = validateExcalidraw(file)
		expect(result.valid).toBe(false)
		expect(result.errors.some((e) => e.includes("elements"))).toBe(true)
	})

	test("rejects duplicate element IDs", () => {
		const file = {
			type: "excalidraw",
			version: 2,
			elements: [
				{
					id: "same-id",
					type: "rectangle",
					x: 0,
					y: 0,
					width: 100,
					height: 100,
					strokeColor: "#000",
					backgroundColor: "#fff",
				},
				{
					id: "same-id",
					type: "rectangle",
					x: 100,
					y: 0,
					width: 100,
					height: 100,
					strokeColor: "#000",
					backgroundColor: "#fff",
				},
			],
			appState: {},
		}

		const result = validateExcalidraw(file)
		expect(result.valid).toBe(false)
		expect(result.errors.some((e) => e.includes("duplicate"))).toBe(true)
	})

	test("validates text element requirements", () => {
		const file = {
			type: "excalidraw",
			version: 2,
			elements: [
				{
					id: "text-1",
					type: "text",
					x: 0,
					y: 0,
					width: 100,
					height: 20,
					strokeColor: "#000",
					backgroundColor: "transparent",
					// missing text and fontSize
				},
			],
			appState: {},
		}

		const result = validateExcalidraw(file)
		expect(result.valid).toBe(false)
		expect(result.errors.some((e) => e.includes("text"))).toBe(true)
		expect(result.errors.some((e) => e.includes("fontSize"))).toBe(true)
	})

	test("validates arrow element requirements", () => {
		const file = {
			type: "excalidraw",
			version: 2,
			elements: [
				{
					id: "arrow-1",
					type: "arrow",
					x: 0,
					y: 0,
					width: 100,
					height: 100,
					strokeColor: "#000",
					backgroundColor: "transparent",
					// missing points
				},
			],
			appState: {},
		}

		const result = validateExcalidraw(file)
		expect(result.valid).toBe(false)
		expect(result.errors.some((e) => e.includes("points"))).toBe(true)
	})

	test("counts element types correctly", () => {
		const file = {
			type: "excalidraw",
			version: 2,
			elements: [
				{
					id: "rect-1",
					type: "rectangle",
					x: 0,
					y: 0,
					width: 100,
					height: 100,
					strokeColor: "#000",
					backgroundColor: "#fff",
				},
				{
					id: "ellipse-1",
					type: "ellipse",
					x: 0,
					y: 0,
					width: 100,
					height: 100,
					strokeColor: "#000",
					backgroundColor: "#fff",
				},
				{
					id: "text-1",
					type: "text",
					x: 0,
					y: 0,
					width: 100,
					height: 20,
					text: "Hello",
					fontSize: 16,
					strokeColor: "#000",
					backgroundColor: "transparent",
				},
				{
					id: "arrow-1",
					type: "arrow",
					x: 0,
					y: 0,
					width: 100,
					height: 100,
					points: [
						[0, 0],
						[100, 100],
					],
					strokeColor: "#000",
					backgroundColor: "transparent",
				},
			],
			appState: {},
		}

		const result = validateExcalidraw(file)
		expect(result.valid).toBe(true)
		expect(result.stats.totalElements).toBe(4)
		expect(result.stats.shapes).toBe(2)
		expect(result.stats.arrows).toBe(1)
		expect(result.stats.texts).toBe(1)
	})
})

describe("isValidExcalidraw", () => {
	test("returns true for valid file", () => {
		const file = {
			type: "excalidraw",
			version: 2,
			elements: [],
			appState: {},
		}

		expect(isValidExcalidraw(file)).toBe(true)
	})

	test("returns false for invalid file", () => {
		expect(isValidExcalidraw({})).toBe(false)
		expect(isValidExcalidraw(null)).toBe(false)
		expect(isValidExcalidraw("string")).toBe(false)
	})
})

describe("renderToExcalidraw output validation", () => {
	test("rendered output passes validation", () => {
		const graph: InfraGraph = {
			nodes: [
				{
					id: "web",
					name: "web",
					type: "container",
					source: { file: "test.yml", format: "docker-compose" },
				},
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
			],
			edges: [
				{ from: "web", to: "db", type: "depends_on" },
				{ from: "web", to: "cache", type: "depends_on" },
			],
			metadata: {
				project: "test",
				parsedAt: new Date().toISOString(),
				sourceFiles: ["test.yml"],
				parserVersion: "0.1.0",
			},
		}

		const excalidraw = renderToExcalidraw(graph)
		const result = validateExcalidraw(excalidraw)

		expect(result.valid).toBe(true)
		expect(result.errors).toHaveLength(0)
		expect(result.stats.shapes).toBe(3)
		expect(result.stats.arrows).toBe(2)
		expect(result.stats.texts).toBe(3)
	})

	test("validates real Sentry output file", async () => {
		// Try to load a real generated file if it exists
		try {
			const testDataDir = join(process.cwd(), "test-data", "sentry", "runs")
			const { readdir } = await import("node:fs/promises")
			const runs = await readdir(testDataDir)
			const latestRun = runs.sort().reverse()[0]

			if (latestRun) {
				const filePath = join(testDataDir, latestRun, "03-excalidraw.json")
				const content = await readFile(filePath, "utf-8")
				const data = JSON.parse(content)

				const result = validateExcalidraw(data)

				// Should be valid
				expect(result.valid).toBe(true)
				expect(result.errors).toHaveLength(0)

				// Sentry has ~70 services, so we expect shapes and texts for each
				expect(result.stats.shapes).toBeGreaterThan(60)
				expect(result.stats.texts).toBeGreaterThan(60)
				expect(result.stats.arrows).toBeGreaterThan(100)

				console.log("Validated Sentry Excalidraw file:")
				console.log(`  - Elements: ${result.stats.totalElements}`)
				console.log(`  - Shapes: ${result.stats.shapes}`)
				console.log(`  - Arrows: ${result.stats.arrows}`)
				console.log(`  - Texts: ${result.stats.texts}`)
				console.log(`  - Warnings: ${result.warnings.length}`)
			}
		} catch {
			// Skip if no test data exists
			console.log("Skipping Sentry file validation (no test data)")
		}
	})
})
