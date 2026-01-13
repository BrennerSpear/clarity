#!/usr/bin/env node
/**
 * Node.js script to run ELK layout
 * Called as a subprocess from Bun because elkjs has CJS compatibility issues
 *
 * Usage: node elk-layout-runner.cjs < input.json > output.json
 */

const ELK = require("elkjs")

async function main() {
	// Read graph from stdin
	let input = ""
	for await (const chunk of process.stdin) {
		input += chunk
	}

	const graph = JSON.parse(input)

	// Run layout
	const elk = new ELK()
	const result = await elk.layout(graph)

	// Output to stdout
	console.log(JSON.stringify(result))
}

main().catch((err) => {
	console.error(err.message)
	process.exit(1)
})
