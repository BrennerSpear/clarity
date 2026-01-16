/**
 * ELK layout runner
 *
 * Uses elkjs directly to compute graph layout positions.
 */

import { createRequire } from "node:module"
import ELK from "elkjs"
import type { ElkGraph } from "./types"

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

type WorkerLike = {
	postMessage: (message: unknown) => void
	onmessage: ((event: { data: unknown }) => void) | null
	terminate?: () => void
}

type WorkerConstructor = new (url?: string) => WorkerLike

const require = createRequire(import.meta.url)

const loadWorkerModule = (): { Worker?: unknown; default?: unknown } => {
	const globalSelf = globalThis as { self?: unknown }
	const hadSelf = Object.prototype.hasOwnProperty.call(globalSelf, "self")
	const originalSelf = globalSelf.self

	try {
		// Force elk-worker.js to use CommonJS exports (Bun sets globalThis.self).
		globalSelf.self = undefined
		return require("elkjs/lib/elk-worker.js") as {
			Worker?: unknown
			default?: unknown
		}
	} finally {
		if (hadSelf) {
			globalSelf.self = originalSelf
		} else {
			delete globalSelf.self
		}
	}
}

const resolveWorkerConstructor = (): WorkerConstructor => {
	const workerModule = loadWorkerModule()

	const maybeWorker =
		workerModule.Worker ??
		workerModule.default ??
		(workerModule as unknown)
	if (typeof maybeWorker === "function") {
		return maybeWorker as WorkerConstructor
	}

	throw new Error("ELK worker module not available")
}

/**
 * Run ELK layout on a graph
 */
export async function runLayout(graph: ElkGraph): Promise<ElkLayoutResult> {
	const WorkerCtor = resolveWorkerConstructor()
	const elk = new ELK({
		workerFactory: (url?: string) => new WorkerCtor(url),
	})
	const result = (await elk.layout(graph)) as ElkGraph

	return {
		graph: result,
		width: result.width ?? 0,
		height: result.height ?? 0,
	}
}
