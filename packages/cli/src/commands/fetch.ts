import { ensureProjectDirs, writeSourceFile } from "@clarity/core"
import { Command } from "commander"

interface ProjectConfig {
	id: string
	name: string
	repo: string
	files: { path: string; format: string }[]
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

async function fetchFileFromGithub(
	repo: string,
	path: string,
): Promise<string> {
	// Convert GitHub repo URL to raw content URL
	// https://github.com/owner/repo -> https://raw.githubusercontent.com/owner/repo/HEAD/path
	const match = repo.match(/github\.com\/([^/]+)\/([^/]+)/)
	if (!match) {
		throw new Error(`Invalid GitHub repo URL: ${repo}`)
	}

	const [, owner, repoName] = match
	const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/HEAD/${path}`

	const response = await fetch(rawUrl)
	if (!response.ok) {
		// Try main branch
		const mainUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/main/${path}`
		const mainResponse = await fetch(mainUrl)
		if (!mainResponse.ok) {
			// Try master branch
			const masterUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/master/${path}`
			const masterResponse = await fetch(masterUrl)
			if (!masterResponse.ok) {
				throw new Error(`Failed to fetch ${path} from ${repo}`)
			}
			return masterResponse.text()
		}
		return mainResponse.text()
	}

	return response.text()
}

export const fetchCommand = new Command("fetch")
	.description("Fetch IaC files from a repository")
	.argument("<project>", "Project ID to fetch")
	.option("-r, --repo <url>", "Override repository URL")
	.option("-f, --file <path>", "Specific file path to fetch")
	.action(
		async (projectId: string, options: { repo?: string; file?: string }) => {
			const registry = await loadProjects()
			const project = registry.projects.find((p) => p.id === projectId)

			if (!project && !options.repo) {
				console.error(
					`Project "${projectId}" not found in projects.json and no --repo specified`,
				)
				process.exit(1)
			}

			const repo = options.repo ?? project?.repo
			if (!repo) {
				console.error("No repository URL found")
				process.exit(1)
			}

			await ensureProjectDirs(projectId)

			// Determine files to fetch
			const filesToFetch: { path: string; format: string }[] = []

			if (options.file) {
				// Fetch single file specified via CLI
				filesToFetch.push({
					path: options.file,
					format: options.file.includes("docker-compose")
						? "docker-compose"
						: "unknown",
				})
			} else if (project?.files) {
				// Fetch files from project config
				filesToFetch.push(...project.files)
			} else {
				// Default: try common docker-compose file names
				filesToFetch.push({
					path: "docker-compose.yml",
					format: "docker-compose",
				})
			}

			console.log(`Fetching files from ${repo}...`)

			for (const file of filesToFetch) {
				try {
					console.log(`  Fetching ${file.path}...`)
					const content = await fetchFileFromGithub(repo, file.path)

					// Use filename for storage
					const filename = file.path.split("/").pop() ?? file.path
					await writeSourceFile(projectId, filename, content)

					console.log(`  \x1b[32m✓\x1b[0m Saved ${filename}`)
				} catch (error) {
					console.error(
						`  \x1b[31m✗\x1b[0m Failed to fetch ${file.path}: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}

			console.log("\nDone!")
		},
	)
