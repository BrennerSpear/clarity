/**
 * ELK layout runner
 *
 * Uses Node.js subprocess to run ELK layout because elkjs has
 * CJS export compatibility issues with Bun's module loader.
 */

import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ElkGraph } from "./types"

const __dirname = dirname(fileURLToPath(import.meta.url))
const RUNNER_SCRIPT = join(__dirname, "elk-layout-runner.cjs")

/**
 * Result of running ELK layout
 */
export interface ElkLayoutResult {
	/** The laid-out graph with x, y coordinates */
	graph: ElkGraph
	/** Total width of the layout */
	width: number
	/** Total height of the layout */
	height: number
}

/**
 * Run ELK layout on a graph using Node.js subprocess
 */
export async function runLayout(graph: ElkGraph): Promise<ElkLayoutResult> {
	return new Promise((resolve, reject) => {
		const child = spawn("node", [RUNNER_SCRIPT], {
			stdio: ["pipe", "pipe", "pipe"],
		})

		let stdout = ""
		let stderr = ""

		child.stdout.on("data", (data) => {
			stdout += data.toString()
		})

		child.stderr.on("data", (data) => {
			stderr += data.toString()
		})

		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`ELK layout failed: ${stderr}`))
				return
			}

			try {
				const result = JSON.parse(stdout) as ElkGraph
				resolve({
					graph: result,
					width: result.width ?? 0,
					height: result.height ?? 0,
				})
			} catch (err) {
				reject(new Error(`Failed to parse ELK output: ${err}`))
			}
		})

		child.on("error", (err) => {
			reject(new Error(`Failed to spawn ELK layout process: ${err.message}`))
		})

		// Send graph to stdin
		child.stdin.write(JSON.stringify(graph))
		child.stdin.end()
	})
}
