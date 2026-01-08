import { Command } from "commander"
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { listRuns, getTestDataDir } from "@clarity/core"

interface ProjectConfig {
	id: string
	name: string
	repo: string
}

interface ProjectsRegistry {
	projects: ProjectConfig[]
}

async function loadProjects(): Promise<ProjectsRegistry> {
	const filepath = `${process.cwd()}/projects.json`
	try {
		const file = Bun.file(filepath)
		return (await file.json()) as ProjectsRegistry
	} catch {
		return { projects: [] }
	}
}

export const listCommand = new Command("list")
	.description("List configured projects and their runs")
	.option("-a, --all", "Show all projects including those without data")
	.action(async (options: { all?: boolean }) => {
		const registry = await loadProjects()

		// Get projects with local data
		const testDataDir = getTestDataDir()
		let projectsWithData: string[] = []
		try {
			const entries = await readdir(testDataDir, { withFileTypes: true })
			projectsWithData = entries.filter((e) => e.isDirectory()).map((e) => e.name)
		} catch {
			// test-data doesn't exist yet
		}

		// Combine registry projects with local data
		const allProjects = new Set<string>()

		for (const p of registry.projects) {
			allProjects.add(p.id)
		}

		for (const p of projectsWithData) {
			allProjects.add(p)
		}

		if (allProjects.size === 0) {
			console.log("No projects found.")
			console.log('\nUse "clarity fetch <project> --repo <url>" to add a project.')
			return
		}

		console.log("Projects:\n")

		for (const projectId of Array.from(allProjects).sort()) {
			const registered = registry.projects.find((p) => p.id === projectId)
			const hasData = projectsWithData.includes(projectId)

			if (!options.all && !hasData) {
				continue
			}

			const runs = hasData ? await listRuns(projectId) : []
			const latestRun = runs[0]

			const name = registered?.name ?? projectId
			const dataStatus = hasData ? "\x1b[32m●\x1b[0m" : "\x1b[90m○\x1b[0m"

			console.log(`${dataStatus} ${name} (${projectId})`)

			if (registered?.repo) {
				console.log(`   Repo: ${registered.repo}`)
			}

			if (hasData) {
				console.log(`   Runs: ${runs.length}`)
				if (latestRun) {
					const statusColor =
						latestRun.status === "completed"
							? "\x1b[32m"
							: latestRun.status === "failed"
								? "\x1b[31m"
								: "\x1b[33m"
					console.log(
						`   Latest: ${latestRun.id} (${statusColor}${latestRun.status}\x1b[0m)`,
					)
				}
			}

			console.log("")
		}
	})
