/**
 * Main generate command - parses IaC files and generates diagrams
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import {
	type EnhancementResponse,
	type InfraGraph,
	type ServiceNode,
	applyEnhancements,
	buildEnhancePrompt,
	checkBrowserAvailability,
	filterOrphanNodes,
	getApiKey,
	infraGraphToElk,
	parseDockerCompose,
	parseHelmChart,
	parseTerraformFiles,
	parseTerraformModule,
	isTerraformPath,
	parseJsonResponse,
	renderExcalidrawToPng,
	renderWithElkLayout,
	runLayout,
	sendMessage,
} from "@clarity-tools/core"

export interface GenerateOptions {
	output?: string
	llm?: boolean
	png?: boolean
	artifacts?: boolean
	values?: string[]
	verbose?: boolean
}

interface DetectedFile {
	type: "docker-compose" | "helm" | "terraform"
	path: string
	name: string
}

/**
 * Detect IaC files in a directory
 */
async function detectIaCFiles(dirPath: string): Promise<DetectedFile[]> {
	const files: DetectedFile[] = []
	const entries = await readdir(dirPath, { withFileTypes: true })
	let hasTerraform = false

	for (const entry of entries) {
		const fullPath = join(dirPath, entry.name)

		if (entry.isFile()) {
			const name = entry.name.toLowerCase()
			if (
				name.includes("docker-compose") ||
				name === "compose.yml" ||
				name === "compose.yaml"
			) {
				files.push({ type: "docker-compose", path: fullPath, name: entry.name })
			}
			if (isTerraformPath(entry.name)) {
				hasTerraform = true
			}
		}

		if (entry.isDirectory()) {
			// Check for Helm chart
			const chartPath = join(fullPath, "Chart.yaml")
			try {
				await stat(chartPath)
				files.push({ type: "helm", path: fullPath, name: entry.name })
			} catch {
				// Also check for Chart.yml
				try {
					await stat(join(fullPath, "Chart.yml"))
					files.push({ type: "helm", path: fullPath, name: entry.name })
				} catch {
					// Not a Helm chart
				}
			}
		}
	}

	// Also check if current directory is a Helm chart
	try {
		await stat(join(dirPath, "Chart.yaml"))
		files.push({ type: "helm", path: dirPath, name: basename(dirPath) })
	} catch {
		try {
			await stat(join(dirPath, "Chart.yml"))
			files.push({ type: "helm", path: dirPath, name: basename(dirPath) })
		} catch {
			// Not a Helm chart
		}
	}

	if (hasTerraform) {
		files.push({ type: "terraform", path: dirPath, name: basename(dirPath) })
	}

	return files
}

/**
 * Parse a single IaC file/directory into an InfraGraph
 */
async function parseIaC(
	detected: DetectedFile,
	options?: { verbose?: boolean; valuesFiles?: string[] },
): Promise<InfraGraph> {
	const verbose = options?.verbose

	if (detected.type === "docker-compose") {
		if (verbose) console.log(`  Parsing Docker Compose: ${detected.path}`)
		const content = await readFile(detected.path, "utf-8")
		return parseDockerCompose(content, detected.name, detected.name)
	}

	if (detected.type === "helm") {
		if (verbose) console.log(`  Parsing Helm chart: ${detected.path}`)
		if (verbose && options?.valuesFiles?.length) {
			console.log(`    With values files: ${options.valuesFiles.join(", ")}`)
		}
		return parseHelmChart(detected.path, detected.name, detected.path, {
			valuesFiles: options?.valuesFiles,
		})
	}

	if (detected.type === "terraform") {
		if (verbose) console.log(`  Parsing Terraform: ${detected.path}`)
		const stats = await stat(detected.path)
		if (stats.isFile()) {
			const content = await readFile(detected.path, "utf-8")
			return parseTerraformFiles(
				[{ path: detected.name, content }],
				detected.name,
			)
		}
		return parseTerraformModule(detected.path, detected.name)
	}

	if (detected.type === "terraform") {
		if (verbose) console.log(`  Parsing Terraform: ${detected.path}`)
		const stats = await stat(detected.path)
		if (stats.isFile()) {
			const content = await readFile(detected.path, "utf-8")
			return parseTerraformFiles(
				[{ path: detected.name, content }],
				detected.name,
			)
		}
		return parseTerraformModule(detected.path, detected.name)
	}

	throw new Error(`Unknown IaC type: ${detected.type}`)
}

/**
 * Enhance graph with LLM metadata
 */
async function enhanceGraph(
	graph: InfraGraph,
	apiKey: string,
	verbose?: boolean,
): Promise<InfraGraph> {
	if (verbose) console.log("  Enhancing with LLM...")

	const prompt = buildEnhancePrompt(graph)
	const response = await sendMessage(apiKey, prompt)
	const enhancements = parseJsonResponse<EnhancementResponse>(response)

	if (!enhancements?.services) {
		if (verbose) console.log("  Warning: No enhancements returned from LLM")
		return graph
	}

	return applyEnhancements(graph, enhancements)
}

/**
 * Generate markdown content for the excluded nodes notes file
 */
function generateNotesContent(orphans: ServiceNode[]): string {
	const lines = [
		"# Excluded Nodes",
		"",
		"The following nodes were found in the source file but excluded from the diagram because they have no connections to other services.",
		"",
		"This may indicate:",
		"- Services that are standalone/isolated",
		"- Missing dependency declarations in the source file",
		"- Init containers or one-off jobs",
		"",
		"## Excluded Services",
		"",
	]

	for (const node of orphans) {
		lines.push(`### ${node.name}`)
		lines.push("")
		if (node.image) {
			lines.push(`- **Image:** \`${node.image}\``)
		}
		lines.push(`- **Type:** ${node.type}`)
		lines.push(`- **Source:** ${node.source.file}`)
		lines.push("")
	}

	return lines.join("\n")
}

/**
 * Main generate function
 */
export async function generate(
	inputPath: string,
	options: GenerateOptions = {},
): Promise<void> {
	const resolvedInput = resolve(inputPath)
	const outputDir = resolve(options.output ?? "./docs/diagrams")
	const verbose = options.verbose ?? false
	const skipPng = options.png === false
	const skipLlm = options.llm === false
	const saveArtifacts = options.artifacts ?? false
	const valuesFiles = options.values?.map((f) => resolve(f))

	// Check browser availability if we need PNG
	if (!skipPng) {
		const browserCheck = await checkBrowserAvailability()
		if (!browserCheck.available) {
			console.error(
				"\x1b[31m✗\x1b[0m Browser not available for PNG rendering\n",
			)
			console.error(browserCheck.error)
			console.error("\nUse --no-png to skip PNG generation")
			process.exit(1)
		}
	}

	// Detect what we're working with
	const inputStat = await stat(resolvedInput)
	let detected: DetectedFile[]

	if (inputStat.isFile()) {
		// Direct file input
		const name = basename(resolvedInput).toLowerCase()
		if (
			name.includes("docker-compose") ||
			name === "compose.yml" ||
			name === "compose.yaml"
		) {
			detected = [
				{
					type: "docker-compose",
					path: resolvedInput,
					name: basename(resolvedInput),
				},
			]
		} else if (isTerraformPath(name)) {
			detected = [
				{
					type: "terraform",
					path: resolvedInput,
					name: basename(resolvedInput),
				},
			]
		} else {
			console.error(`\x1b[31m✗\x1b[0m Unrecognized file type: ${resolvedInput}`)
			console.error("Supported: docker-compose.yml, compose.yml, *.tf, *.tf.json")
			process.exit(1)
		}
	} else if (inputStat.isDirectory()) {
		// Detect files in directory
		detected = await detectIaCFiles(resolvedInput)
		if (detected.length === 0) {
			console.error(`\x1b[31m✗\x1b[0m No IaC files found in: ${resolvedInput}`)
			console.error(
				"Looking for: docker-compose.yml, compose.yml, Chart.yaml, *.tf, *.tf.json",
			)
			process.exit(1)
		}
	} else {
		console.error(`\x1b[31m✗\x1b[0m Invalid path: ${resolvedInput}`)
		process.exit(1)
	}

	// Ensure output directory exists
	await mkdir(outputDir, { recursive: true })

	// Get API key for LLM enhancement
	const apiKey = getApiKey()
	const llmEnabled = !skipLlm && !!apiKey

	if (!skipLlm && !apiKey && verbose) {
		console.log("  Note: No API key configured, skipping LLM enhancement")
		console.log("  Run: iac-diagrams config set-key <your-openrouter-key>")
	}

	// Process each detected file
	for (const file of detected) {
		console.log(`\nGenerating diagram for: ${file.name}`)
		const baseName = file.name.replace(/\.(yml|yaml)$/i, "")
		const writeArtifact = async (suffix: string, data: unknown) => {
			if (!saveArtifacts) return
			const artifactPath = join(outputDir, `${baseName}.${suffix}.json`)
			await writeFile(artifactPath, JSON.stringify(data, null, 2))
			console.log(`  \x1b[32m✓\x1b[0m Saved: ${artifactPath}`)
		}

		// 1. Parse
		if (verbose) console.log("  Step 1: Parsing...")
		const parsedGraph = await parseIaC(file, { verbose, valuesFiles })

		// Filter out orphan nodes (nodes with no edges)
		const { graph: filteredGraph, orphans } = filterOrphanNodes(parsedGraph)
		let graph = filteredGraph

		if (verbose) {
			console.log(`    Found ${parsedGraph.nodes.length} services`)
			console.log(`    Found ${graph.edges.length} dependencies`)
		}

		// Log orphan warnings
		if (orphans.length > 0) {
			console.log(
				`  \x1b[33m!\x1b[0m Excluded ${orphans.length} orphan node(s) with no connections:`,
			)
			for (const orphan of orphans) {
				console.log(`    - ${orphan.name}`)
			}
		}

		await writeArtifact("parsed", parsedGraph)

		// 2. Enhance (optional)
		if (llmEnabled && apiKey) {
			if (verbose) console.log("  Step 2: Enhancing with LLM...")
			try {
				graph = await enhanceGraph(graph, apiKey, verbose)
			} catch (err) {
				console.error(
					`  \x1b[33m!\x1b[0m LLM enhancement failed: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		} else if (verbose) {
			console.log("  Step 2: Skipping LLM enhancement")
		}
		await writeArtifact("enhanced", graph)

		// 3. Layout
		if (verbose) console.log("  Step 3: Computing layout...")
		const elkConversion = infraGraphToElk(graph)
		const elkLayoutResult = await runLayout(elkConversion.graph)
		await writeArtifact("elk-input", elkConversion.graph)
		await writeArtifact("elk-output", elkLayoutResult.graph)

		// 4. Generate Excalidraw
		if (verbose) console.log("  Step 4: Generating Excalidraw...")
		const excalidraw = renderWithElkLayout(graph, elkLayoutResult.graph)

		// 5. Save outputs
		const excalidrawPath = join(outputDir, `${baseName}.excalidraw`)
		await writeFile(excalidrawPath, JSON.stringify(excalidraw, null, 2))
		console.log(`  \x1b[32m✓\x1b[0m Saved: ${excalidrawPath}`)

		// 6. Render PNG (optional)
		if (!skipPng) {
			if (verbose) console.log("  Step 5: Rendering PNG...")
			const pngBuffer = await renderExcalidrawToPng(excalidraw)
			const pngPath = join(outputDir, `${baseName}.png`)
			await writeFile(pngPath, pngBuffer)
			console.log(`  \x1b[32m✓\x1b[0m Saved: ${pngPath}`)
		}

		// 7. Write notes file if there were orphans
		if (orphans.length > 0) {
			const notesContent = generateNotesContent(orphans)
			const notesPath = join(outputDir, `${baseName}.excluded.md`)
			await writeFile(notesPath, notesContent)
			console.log(`  \x1b[32m✓\x1b[0m Saved: ${notesPath}`)
		}
	}

	console.log("\n\x1b[32m✓\x1b[0m Done!")
}
