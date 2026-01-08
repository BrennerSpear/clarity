import { Command } from "commander"
import { loadRunMeta, loadParsedGraph, listRuns, getRunDir } from "@clarity/core"
import { formatRunSummary, formatGraphSummary } from "../utils/output"

export const inspectCommand = new Command("inspect")
	.description("Inspect a pipeline run")
	.argument("<project>", "Project ID")
	.option("-r, --run <id>", "Run ID (defaults to latest)")
	.option("-s, --step <step>", "Show details for a specific step")
	.option("--json", "Output raw JSON")
	.action(
		async (
			projectId: string,
			options: { run?: string; step?: string; json?: boolean },
		) => {
			let runId = options.run

			// If no run specified, get the latest
			if (!runId) {
				const runs = await listRuns(projectId)
				if (runs.length === 0) {
					console.error(`No runs found for project: ${projectId}`)
					process.exit(1)
				}
				runId = runs[0]?.id
			}

			if (!runId) {
				console.error("No run ID found")
				process.exit(1)
			}

			const run = await loadRunMeta(projectId, runId)
			if (!run) {
				console.error(`Run not found: ${runId}`)
				process.exit(1)
			}

			if (options.json) {
				console.log(JSON.stringify(run, null, 2))
				return
			}

			console.log(formatRunSummary(run))
			console.log(`\nRun directory: ${getRunDir(projectId, runId)}`)

			// If a specific step is requested, show more detail
			if (options.step) {
				const stepResult = run.steps.find((s) => s.step === options.step)
				if (!stepResult) {
					console.error(`Step "${options.step}" not found in this run`)
					return
				}

				console.log(`\n--- ${options.step} details ---\n`)

				if (options.step === "parse") {
					const graph = await loadParsedGraph(projectId, runId)
					if (graph) {
						console.log(formatGraphSummary(graph))
					}
				}
			} else {
				// Show graph summary if parse completed
				const parseStep = run.steps.find((s) => s.step === "parse")
				if (parseStep?.status === "completed") {
					const graph = await loadParsedGraph(projectId, runId)
					if (graph) {
						console.log("\n--- Graph Summary ---\n")
						console.log(formatGraphSummary(graph))
					}
				}
			}
		},
	)
