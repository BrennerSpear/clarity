/**
 * Visual validation of generated diagrams using Claude Vision
 */

import type Anthropic from "@anthropic-ai/sdk"
import type { InfraGraph } from "../graph/types"
import { createClient, sendMessage } from "../llm/client"

/**
 * Validation scores for different aspects of the diagram
 */
export interface ValidationScores {
	/** 0-100: Are all expected nodes visible? */
	completeness: number
	/** 0-100: Is the layout clear and readable? */
	clarity: number
	/** 0-100: Are edges clear and not overlapping? */
	connections: number
	/** 0-100: Is logical grouping evident? */
	grouping: number
}

/**
 * Result of visual validation
 */
export interface VisualValidationResult {
	valid: boolean
	issues: string[]
	suggestions: string[]
	scores: ValidationScores
}

/**
 * Validation summary for a pipeline run
 */
export interface ValidationSummary {
	passed: boolean
	averageScore: number
	results: Record<string, VisualValidationResult>
	timestamp: string
}

/**
 * Validation thresholds
 */
export const VALIDATION_THRESHOLDS = {
	/** Individual score minimum */
	minimumScore: 70,
	/** Average across all scores */
	minimumAverage: 80,
	/** Must pass basic validity check */
	requiredValid: true,
}

/**
 * Check if validation result meets thresholds
 */
export function isValidationPassing(result: VisualValidationResult): boolean {
	const scores = Object.values(result.scores)
	const average = scores.reduce((a, b) => a + b, 0) / scores.length
	const allAboveMinimum = scores.every(
		(s) => s >= VALIDATION_THRESHOLDS.minimumScore,
	)

	return (
		result.valid && allAboveMinimum && average >= VALIDATION_THRESHOLDS.minimumAverage
	)
}

/**
 * Calculate average score from validation result
 */
export function calculateAverageScore(result: VisualValidationResult): number {
	const scores = Object.values(result.scores)
	return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
}

/**
 * Build the validation prompt for Claude Vision
 */
function buildValidationPrompt(graph: InfraGraph): string {
	const expectedServices = graph.nodes.map((n) => n.name).join(", ")
	const expectedConnections = graph.edges.length

	return `Validate this infrastructure diagram.

Expected:
- ${graph.nodes.length} services: ${expectedServices}
- ${expectedConnections} connections between services

Evaluate:
1. COMPLETENESS: Are all ${graph.nodes.length} services visible and labeled?
2. CLARITY: Is the text readable? Are boxes appropriately sized?
3. CONNECTIONS: Are the ${expectedConnections} edges clear? Any overlapping lines?
4. GROUPING: Are related services (databases, caches, app servers) visually grouped?

Return JSON only:
{
  "valid": boolean,
  "issues": ["list of problems found"],
  "suggestions": ["list of improvements"],
  "scores": {
    "completeness": 0-100,
    "clarity": 0-100,
    "connections": 0-100,
    "grouping": 0-100
  }
}`
}

/**
 * Parse JSON from Claude's response
 */
function parseValidationResponse(text: string): VisualValidationResult {
	const jsonMatch = text.match(/\{[\s\S]*\}/)
	if (!jsonMatch) {
		throw new Error("Failed to parse validation response: no JSON found")
	}

	try {
		const parsed = JSON.parse(jsonMatch[0])

		// Validate the structure
		if (typeof parsed.valid !== "boolean") {
			throw new Error("Missing 'valid' field")
		}
		if (!Array.isArray(parsed.issues)) {
			parsed.issues = []
		}
		if (!Array.isArray(parsed.suggestions)) {
			parsed.suggestions = []
		}
		if (!parsed.scores || typeof parsed.scores !== "object") {
			throw new Error("Missing 'scores' object")
		}

		// Ensure all scores are numbers in 0-100 range
		const scoreFields: (keyof ValidationScores)[] = [
			"completeness",
			"clarity",
			"connections",
			"grouping",
		]
		for (const field of scoreFields) {
			if (typeof parsed.scores[field] !== "number") {
				parsed.scores[field] = 0
			} else {
				parsed.scores[field] = Math.max(
					0,
					Math.min(100, Math.round(parsed.scores[field])),
				)
			}
		}

		return parsed as VisualValidationResult
	} catch (error) {
		throw new Error(
			`Failed to parse validation response: ${error instanceof Error ? error.message : String(error)}`,
		)
	}
}

/**
 * Validate a diagram PNG using Claude Vision
 */
export async function validateDiagram(
	pngBuffer: Buffer,
	graph: InfraGraph,
	client?: Anthropic,
	model?: string,
): Promise<VisualValidationResult> {
	const llmClient = client ?? createClient()
	const llmModel = model ?? "claude-sonnet-4-20250514"

	const base64 = pngBuffer.toString("base64")
	const prompt = buildValidationPrompt(graph)

	const response = await llmClient.messages.create({
		model: llmModel,
		max_tokens: 1024,
		messages: [
			{
				role: "user",
				content: [
					{
						type: "image",
						source: {
							type: "base64",
							media_type: "image/png",
							data: base64,
						},
					},
					{
						type: "text",
						text: prompt,
					},
				],
			},
		],
	})

	const text =
		response.content[0]?.type === "text" ? response.content[0].text : ""

	return parseValidationResponse(text)
}

/**
 * Validate a diagram from file path
 */
export async function validateDiagramFromFile(
	pngPath: string,
	graph: InfraGraph,
	client?: Anthropic,
	model?: string,
): Promise<VisualValidationResult> {
	const { readFile } = await import("node:fs/promises")
	const buffer = await readFile(pngPath)
	return validateDiagram(buffer, graph, client, model)
}

/**
 * Create a validation summary from multiple results
 */
export function createValidationSummary(
	results: Record<string, VisualValidationResult>,
): ValidationSummary {
	const allScores: number[] = []

	for (const result of Object.values(results)) {
		allScores.push(...Object.values(result.scores))
	}

	const averageScore =
		allScores.length > 0
			? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
			: 0

	const passed = Object.values(results).every(isValidationPassing)

	return {
		passed,
		averageScore,
		results,
		timestamp: new Date().toISOString(),
	}
}
