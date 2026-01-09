/**
 * Claude API client for LLM enhancement
 */

import Anthropic from "@anthropic-ai/sdk"

export interface LLMClientConfig {
	apiKey?: string
	model?: string
	maxTokens?: number
}

const DEFAULT_MODEL = "claude-sonnet-4-20250514"
const DEFAULT_MAX_TOKENS = 4096

/**
 * Create an Anthropic client instance
 */
export function createClient(config?: LLMClientConfig): Anthropic {
	return new Anthropic({
		apiKey: config?.apiKey ?? process.env.ANTHROPIC_API_KEY,
	})
}

/**
 * Send a message to Claude and get a response
 */
export async function sendMessage(
	client: Anthropic,
	prompt: string,
	config?: LLMClientConfig,
): Promise<string> {
	const response = await client.messages.create({
		model: config?.model ?? DEFAULT_MODEL,
		max_tokens: config?.maxTokens ?? DEFAULT_MAX_TOKENS,
		messages: [
			{
				role: "user",
				content: prompt,
			},
		],
	})

	const textBlock = response.content.find((block) => block.type === "text")
	if (!textBlock || textBlock.type !== "text") {
		throw new Error("No text response from Claude")
	}

	return textBlock.text
}

/**
 * Find balanced JSON structure starting at a position
 */
function findBalancedJson(
	text: string,
	startChar: string,
	endChar: string,
): string | null {
	const startIdx = text.indexOf(startChar)
	if (startIdx === -1) return null

	let depth = 0
	let inString = false
	let escapeNext = false

	for (let i = startIdx; i < text.length; i++) {
		const char = text[i]

		if (escapeNext) {
			escapeNext = false
			continue
		}

		if (char === "\\") {
			escapeNext = true
			continue
		}

		if (char === '"') {
			inString = !inString
			continue
		}

		if (inString) continue

		if (char === startChar) {
			depth++
		} else if (char === endChar) {
			depth--
			if (depth === 0) {
				return text.slice(startIdx, i + 1)
			}
		}
	}

	return null
}

/**
 * Parse JSON from an LLM response, handling markdown code blocks
 */
export function parseJsonResponse<T>(response: string): T {
	// Try to extract JSON from markdown code blocks
	const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/)
	const jsonString = jsonMatch ? jsonMatch[1]?.trim() : response.trim()

	if (!jsonString) {
		throw new Error("Empty response from LLM")
	}

	try {
		return JSON.parse(jsonString) as T
	} catch {
		// Find the positions of first object and first array
		const objectIdx = response.indexOf("{")
		const arrayIdx = response.indexOf("[")

		// Try whichever appears first in the response
		const tryObjectFirst =
			objectIdx !== -1 && (arrayIdx === -1 || objectIdx < arrayIdx)

		if (tryObjectFirst) {
			// Try object first
			const objectJson = findBalancedJson(response, "{", "}")
			if (objectJson) {
				try {
					return JSON.parse(objectJson) as T
				} catch {
					// Continue to try array
				}
			}
			// Then try array
			const arrayJson = findBalancedJson(response, "[", "]")
			if (arrayJson) {
				try {
					return JSON.parse(arrayJson) as T
				} catch {
					// Continue to error
				}
			}
		} else {
			// Try array first
			const arrayJson = findBalancedJson(response, "[", "]")
			if (arrayJson) {
				try {
					return JSON.parse(arrayJson) as T
				} catch {
					// Continue to try object
				}
			}
			// Then try object
			const objectJson = findBalancedJson(response, "{", "}")
			if (objectJson) {
				try {
					return JSON.parse(objectJson) as T
				} catch {
					// Continue to error
				}
			}
		}

		throw new Error(
			`Failed to parse JSON from LLM response: ${response.slice(0, 200)}`,
		)
	}
}
