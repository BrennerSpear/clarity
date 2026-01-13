import { parseDockerCompose } from "./packages/core/src/parsers/docker-compose"
import { renderGroupedToExcalidraw } from "./packages/core/src/excalidraw/render"
import { renderExcalidrawToPng } from "./packages/core/src/output/png"
import { readFile, writeFile, mkdir } from "node:fs/promises"

function getDateTimeString(): string {
	const now = new Date()
	const year = now.getFullYear()
	const month = String(now.getMonth() + 1).padStart(2, "0")
	const day = String(now.getDate()).padStart(2, "0")
	const hour = String(now.getHours()).padStart(2, "0")
	const minute = String(now.getMinutes()).padStart(2, "0")
	const second = String(now.getSeconds()).padStart(2, "0")
	return `${year}-${month}-${day}-${hour}${minute}${second}`
}

async function main() {
	const datetime = getDateTimeString()
	console.log(`Testing arrows with proper edge connections (${datetime})...\n`)

	const content = await readFile(
		"./test-data/sentry/source/docker-compose.yml",
		"utf-8",
	)
	const graph = parseDockerCompose(content, "docker-compose.yml", "sentry")

	const excalidraw = renderGroupedToExcalidraw(graph, {
		orthogonalArrows: true,
		useSemanticLayout: true,
		showEdgeDirection: true,
	})

	const outDir = `./test-data/sentry/runs/${datetime}`
	await mkdir(outDir, { recursive: true })

	// Write as JSON
	await writeFile(
		`${outDir}/excalidraw.json`,
		JSON.stringify(excalidraw, null, 2),
	)

	// Write as .excalidraw file (same format, different extension for direct opening)
	await writeFile(
		`${outDir}/sentry-${datetime}.excalidraw`,
		JSON.stringify(excalidraw, null, 2),
	)

	console.log("Rendering PNG...")
	const png = await renderExcalidrawToPng(excalidraw)
	await writeFile(`${outDir}/diagram.png`, png)

	console.log(`Output: ${outDir}/diagram.png`)
	console.log(`Excalidraw file: ${outDir}/sentry-${datetime}.excalidraw`)
}

main().catch(console.error)
