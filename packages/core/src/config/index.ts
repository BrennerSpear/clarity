/**
 * Configuration storage for Clarity CLI
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export interface ClarityConfig {
	openRouterApiKey?: string
}

/**
 * Get the path to the config file
 */
export function getConfigPath(): string {
	return join(homedir(), ".config", "clarity", "config.json")
}

/**
 * Load config from disk
 */
export function loadConfig(): ClarityConfig {
	const configPath = getConfigPath()

	if (!existsSync(configPath)) {
		return {}
	}

	try {
		const content = readFileSync(configPath, "utf-8")
		return JSON.parse(content) as ClarityConfig
	} catch {
		return {}
	}
}

/**
 * Save config to disk
 */
export function saveConfig(config: ClarityConfig): void {
	const configPath = getConfigPath()
	const configDir = dirname(configPath)

	if (!existsSync(configDir)) {
		mkdirSync(configDir, { recursive: true })
	}

	writeFileSync(configPath, JSON.stringify(config, null, 2))
}

/**
 * Get the OpenRouter API key from config or environment
 * Priority: config file > OPENROUTER_API_KEY env var
 */
export function getApiKey(): string | undefined {
	const config = loadConfig()
	return config.openRouterApiKey ?? process.env.OPENROUTER_API_KEY
}

/**
 * Check if an API key is available
 */
export function hasApiKey(): boolean {
	return getApiKey() !== undefined
}

/**
 * Mask an API key for display (show first 8 and last 4 chars)
 */
export function maskApiKey(key: string): string {
	if (key.length <= 12) {
		return "*".repeat(key.length)
	}
	return `${key.slice(0, 8)}...${key.slice(-4)}`
}
