#!/usr/bin/env bun
/**
 * Validate a generated Excalidraw JSON file
 * Usage: bun scripts/validate-output.ts [path-to-json]
 */

import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { validateExcalidraw } from "../packages/core/src/excalidraw/validate"

async function main() {
	const args = process.argv.slice(2)
	let filePath = args[0]

	// If no path provided, find the latest run
	if (!filePath) {
		const testDataDir = join(process.cwd(), "test-data", "sentry", "runs")
		try {
			const runs = await readdir(testDataDir)
			const latestRun = runs.sort().reverse()[0]
			if (latestRun) {
				filePath = join(testDataDir, latestRun, "diagram.excalidraw")
				console.log(`Using latest run: ${latestRun}`)
			}
		} catch {
			console.error("No test data found. Run the pipeline first:")
			console.error("  bun run clarity run sentry")
			process.exit(1)
		}
	}

	if (!filePath) {
		console.error("No Excalidraw file found")
		process.exit(1)
	}

	console.log(`Validating: ${filePath}\n`)

	try {
		const content = await readFile(filePath, "utf-8")
		const data = JSON.parse(content)

		const result = validateExcalidraw(data)

		console.log("=== Validation Results ===\n")

		if (result.valid) {
			console.log("\x1b[32m✓ VALID Excalidraw file\x1b[0m\n")
		} else {
			console.log("\x1b[31m✗ INVALID Excalidraw file\x1b[0m\n")
		}

		console.log("Statistics:")
		console.log(`  Total elements: ${result.stats.totalElements}`)
		console.log(`  Shapes (nodes): ${result.stats.shapes}`)
		console.log(`  Arrows (edges): ${result.stats.arrows}`)
		console.log(`  Text labels:    ${result.stats.texts}`)

		if (result.errors.length > 0) {
			console.log(`\n\x1b[31mErrors (${result.errors.length}):\x1b[0m`)
			for (const error of result.errors.slice(0, 20)) {
				console.log(`  - ${error}`)
			}
			if (result.errors.length > 20) {
				console.log(`  ... and ${result.errors.length - 20} more errors`)
			}
		}

		if (result.warnings.length > 0) {
			console.log(`\n\x1b[33mWarnings (${result.warnings.length}):\x1b[0m`)
			for (const warning of result.warnings.slice(0, 10)) {
				console.log(`  - ${warning}`)
			}
			if (result.warnings.length > 10) {
				console.log(`  ... and ${result.warnings.length - 10} more warnings`)
			}
		}

		if (result.valid) {
			console.log("\n=== How to view this diagram ===")
			console.log("1. Go to https://excalidraw.com")
			console.log("2. Click the menu (☰) → Open")
			console.log(`3. Select: ${filePath}`)
		}

		process.exit(result.valid ? 0 : 1)
	} catch (error) {
		console.error("Failed to read/parse file:", error)
		process.exit(1)
	}
}

main()
