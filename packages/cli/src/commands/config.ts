import {
	getConfigPath,
	loadConfig,
	maskApiKey,
	saveConfig,
} from "@clarity/core"
import { Command } from "commander"

export const configCommand = new Command("config")
	.description("Manage Clarity configuration")

configCommand
	.command("set-key <key>")
	.description("Set your OpenRouter API key")
	.action((key: string) => {
		const config = loadConfig()
		config.openRouterApiKey = key
		saveConfig(config)
		console.log(`API key saved to ${getConfigPath()}`)
	})

configCommand
	.command("show")
	.description("Show current configuration")
	.action(() => {
		const configPath = getConfigPath()
		const config = loadConfig()
		const envKey = process.env.OPENROUTER_API_KEY

		console.log(`Config file: ${configPath}\n`)

		if (config.openRouterApiKey) {
			console.log(`OpenRouter API key (config): ${maskApiKey(config.openRouterApiKey)}`)
		} else if (envKey) {
			console.log(`OpenRouter API key (env): ${maskApiKey(envKey)}`)
		} else {
			console.log("OpenRouter API key: not set")
			console.log("\nTo enable LLM enhancement, run:")
			console.log("  clarity config set-key <your-openrouter-api-key>")
		}
	})

configCommand
	.command("clear")
	.description("Clear the stored API key")
	.action(() => {
		const config = loadConfig()
		delete config.openRouterApiKey
		saveConfig(config)
		console.log("API key cleared")

		if (process.env.OPENROUTER_API_KEY) {
			console.log("\nNote: OPENROUTER_API_KEY environment variable is still set")
		}
	})

configCommand
	.command("path")
	.description("Show the config file path")
	.action(() => {
		console.log(getConfigPath())
	})
