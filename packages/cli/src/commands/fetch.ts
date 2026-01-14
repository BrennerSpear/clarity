import { ensureProjectDirs, getSourceDir, writeSourceFile } from "@clarity/core"
import { Command } from "commander"
import { execFile } from "node:child_process"
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { promisify } from "node:util"
import { parse as parseYaml } from "yaml"

const execFileAsync = promisify(execFile)

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

function normalizeRepoUrl(repo: string): string {
	return repo.replace(/\/+$/, "")
}

function resolveChartUrl(repo: string, chartUrl: string): string {
	if (chartUrl.startsWith("oci://")) {
		throw new Error("OCI Helm charts are not supported yet")
	}
	if (chartUrl.startsWith("http://") || chartUrl.startsWith("https://")) {
		return chartUrl
	}
	const base = normalizeRepoUrl(repo)
	return `${base}/${chartUrl.replace(/^\/+/, "")}`
}

async function fetchHelmChartFromRepo(
	projectId: string,
	repo: string,
	chartName: string,
): Promise<string> {
	const indexUrl = `${normalizeRepoUrl(repo)}/index.yaml`
	const indexResponse = await fetch(indexUrl)
	if (!indexResponse.ok) {
		throw new Error(`Failed to fetch Helm index from ${indexUrl}`)
	}

	const indexYaml = await indexResponse.text()
	const index = parseYaml(indexYaml) as {
		entries?: Record<string, { urls?: string[]; version?: string }[]>
	}

	const entries = index?.entries?.[chartName]
	if (!entries || entries.length === 0) {
		throw new Error(`Chart "${chartName}" not found in Helm repo`)
	}

	const chartEntry = entries[0]
	const chartUrl = chartEntry?.urls?.[0]
	if (!chartUrl) {
		throw new Error(`No chart URL found for "${chartName}"`)
	}

	const resolvedUrl = resolveChartUrl(repo, chartUrl)
	const chartResponse = await fetch(resolvedUrl)
	if (!chartResponse.ok) {
		throw new Error(`Failed to download chart from ${resolvedUrl}`)
	}

	const archiveBuffer = Buffer.from(await chartResponse.arrayBuffer())
	const tempDir = await mkdtemp(join(tmpdir(), "clarity-helm-"))
	const archivePath = join(tempDir, `${chartName}.tgz`)
	await writeFile(archivePath, archiveBuffer)

	const destDir = getSourceDir(projectId)
	await execFileAsync("tar", ["-xzf", archivePath, "-C", destDir])
	await rm(tempDir, { recursive: true, force: true })

	return join(destDir, chartName)
}

async function copyLocalHelmChart(
	projectId: string,
	chartPath: string,
): Promise<string> {
	const resolvedPath = resolve(chartPath)
	const chartName = basename(resolvedPath)
	const destDir = join(getSourceDir(projectId), chartName)
	await cp(resolvedPath, destDir, { recursive: true, force: true })
	return destDir
}

export const fetchCommand = new Command("fetch")
	.description("Fetch IaC files from a repository")
	.argument("<project>", "Project ID to fetch")
	.option("-r, --repo <url>", "Override repository URL")
	.option("-f, --file <path>", "Specific file path to fetch")
	.option("--helm <chart>", "Fetch Helm chart from a Helm repo")
	.option("--helm-path <path>", "Fetch Helm chart from a local path")
	.action(
		async (
			projectId: string,
			options: {
				repo?: string
				file?: string
				helm?: string
				helmPath?: string
			},
		) => {
			const registry = await loadProjects()
			const project = registry.projects.find((p) => p.id === projectId)

			if (!project && !options.repo && !options.helmPath) {
				console.error(
					`Project "${projectId}" not found in projects.json and no --repo specified`,
				)
				process.exit(1)
			}

			const repo = options.repo ?? project?.repo
			if (!repo && !options.helmPath) {
				console.error("No repository URL found")
				process.exit(1)
			}

			await ensureProjectDirs(projectId)

			if (options.helmPath) {
				try {
					const dest = await copyLocalHelmChart(projectId, options.helmPath)
					console.log(`\x1b[32m✓\x1b[0m Copied Helm chart to ${dest}`)
					console.log("\nDone!")
					return
				} catch (error) {
					console.error(
						`\x1b[31m✗\x1b[0m Failed to copy Helm chart: ${error instanceof Error ? error.message : String(error)}`,
					)
					process.exit(1)
				}
			}

			if (options.helm) {
				if (!repo) {
					console.error("Helm chart fetch requires --repo <helm-repo-url>")
					process.exit(1)
				}
				try {
					const dest = await fetchHelmChartFromRepo(
						projectId,
						repo,
						options.helm,
					)
					console.log(`\x1b[32m✓\x1b[0m Extracted Helm chart to ${dest}`)
					console.log("\nDone!")
					return
				} catch (error) {
					console.error(
						`\x1b[31m✗\x1b[0m Failed to fetch Helm chart: ${error instanceof Error ? error.message : String(error)}`,
					)
					process.exit(1)
				}
			}

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
