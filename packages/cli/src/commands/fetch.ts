import { ensureProjectDirs, writeSourceFile } from "@clarity/core"
import { $ } from "bun"
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

/**
 * Fetch Helm chart from a Helm repository using helm CLI
 */
async function fetchHelmChart(
	chartName: string,
	repoUrl: string,
	projectId: string,
	version?: string,
): Promise<void> {
	// Add the repo temporarily
	const repoName = `clarity-temp-${Date.now()}`

	try {
		console.log(`  Adding Helm repository ${repoUrl}...`)
		await $`helm repo add ${repoName} ${repoUrl}`.quiet()
		await $`helm repo update ${repoName}`.quiet()

		// Pull the chart
		const chartRef = `${repoName}/${chartName}`
		const pullArgs = ["pull", chartRef, "--untar"]
		if (version) {
			pullArgs.push("--version", version)
		}

		// Create temp directory for download
		const tempDir = `/tmp/clarity-helm-${Date.now()}`
		await $`mkdir -p ${tempDir}`

		console.log(`  Pulling ${chartName}${version ? `@${version}` : ""}...`)
		await $`helm ${pullArgs} -d ${tempDir}`.quiet()

		// Find the chart directory (helm extracts to chartName/)
		const chartDir = `${tempDir}/${chartName}`

		// Copy Chart.yaml and values.yaml to project source directory
		const chartYaml = Bun.file(`${chartDir}/Chart.yaml`)
		const valuesYaml = Bun.file(`${chartDir}/values.yaml`)

		if (await chartYaml.exists()) {
			const content = await chartYaml.text()
			await writeSourceFile(projectId, "Chart.yaml", content)
			console.log("  \x1b[32m✓\x1b[0m Saved Chart.yaml")
		}

		if (await valuesYaml.exists()) {
			const content = await valuesYaml.text()
			await writeSourceFile(projectId, "values.yaml", content)
			console.log("  \x1b[32m✓\x1b[0m Saved values.yaml")
		}

		// Cleanup temp directory
		await $`rm -rf ${tempDir}`.quiet()
	} finally {
		// Remove the temporary repo
		await $`helm repo remove ${repoName}`.quiet().nothrow()
	}
}

/**
 * Fetch Helm chart from a local directory
 */
async function fetchHelmChartFromPath(
	chartPath: string,
	projectId: string,
): Promise<void> {
	const chartYaml = Bun.file(`${chartPath}/Chart.yaml`)
	const valuesYaml = Bun.file(`${chartPath}/values.yaml`)

	if (!(await chartYaml.exists())) {
		throw new Error(`Chart.yaml not found in ${chartPath}`)
	}

	if (!(await valuesYaml.exists())) {
		throw new Error(`values.yaml not found in ${chartPath}`)
	}

	const chartContent = await chartYaml.text()
	const valuesContent = await valuesYaml.text()

	await writeSourceFile(projectId, "Chart.yaml", chartContent)
	console.log("  \x1b[32m✓\x1b[0m Saved Chart.yaml")

	await writeSourceFile(projectId, "values.yaml", valuesContent)
	console.log("  \x1b[32m✓\x1b[0m Saved values.yaml")
}

export const fetchCommand = new Command("fetch")
	.description("Fetch IaC files from a repository")
	.argument("<project>", "Project ID to fetch")
	.option("-r, --repo <url>", "Override repository URL")
	.option("-f, --file <path>", "Specific file path to fetch")
	.option("-h, --helm <chart>", "Fetch Helm chart by name from repository")
	.option("--helm-repo <url>", "Helm repository URL (default: bitnami)")
	.option("--helm-path <path>", "Fetch Helm chart from local directory")
	.option("--helm-version <version>", "Specific Helm chart version to fetch")
	.action(
		async (
			projectId: string,
			options: {
				repo?: string
				file?: string
				helm?: string
				helmRepo?: string
				helmPath?: string
				helmVersion?: string
			},
		) => {
			await ensureProjectDirs(projectId)

			// Handle Helm chart from local path
			if (options.helmPath) {
				console.log(`Fetching Helm chart from ${options.helmPath}...`)
				try {
					await fetchHelmChartFromPath(options.helmPath, projectId)
					console.log("\nDone!")
				} catch (error) {
					console.error(
						`\x1b[31m✗\x1b[0m Failed to fetch Helm chart: ${error instanceof Error ? error.message : String(error)}`,
					)
					process.exit(1)
				}
				return
			}

			// Handle Helm chart from repository
			if (options.helm) {
				const helmRepo =
					options.helmRepo ?? "https://charts.bitnami.com/bitnami"
				console.log(`Fetching Helm chart ${options.helm} from ${helmRepo}...`)
				try {
					await fetchHelmChart(
						options.helm,
						helmRepo,
						projectId,
						options.helmVersion,
					)
					console.log("\nDone!")
				} catch (error) {
					console.error(
						`\x1b[31m✗\x1b[0m Failed to fetch Helm chart: ${error instanceof Error ? error.message : String(error)}`,
					)
					process.exit(1)
				}
				return
			}

			// Handle GitHub repository (existing behavior)
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
