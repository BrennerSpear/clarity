import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	target: "node18",
	outDir: "dist",
	clean: true,
	splitting: false,
	sourcemap: false,
	dts: false,
	// Bundle @clarity-tools/core into the output
	noExternal: [/@clarity-tools\//],
	// Keep all npm dependencies external (installed by users)
	external: ["puppeteer", "commander", "yaml", "elkjs", "zod"],
	banner: {
		js: "#!/usr/bin/env node",
	},
	esbuildOptions(options) {
		options.banner = {
			js: "#!/usr/bin/env node",
		}
	},
})
