/**
 * Validate Excalidraw JSON structure
 */

import type { ExcalidrawElement, ExcalidrawFile } from "./types"

export interface ValidationResult {
	valid: boolean
	errors: string[]
	warnings: string[]
	stats: {
		totalElements: number
		shapes: number
		arrows: number
		texts: number
	}
}

const VALID_ELEMENT_TYPES = [
	"rectangle",
	"ellipse",
	"diamond",
	"text",
	"arrow",
	"line",
	"freedraw",
	"image",
	"frame",
] as const

/**
 * Validate an Excalidraw file structure
 */
export function validateExcalidraw(data: unknown): ValidationResult {
	const errors: string[] = []
	const warnings: string[] = []

	// Check if it's an object
	if (!data || typeof data !== "object") {
		return {
			valid: false,
			errors: ["Input is not an object"],
			warnings: [],
			stats: { totalElements: 0, shapes: 0, arrows: 0, texts: 0 },
		}
	}

	const file = data as Record<string, unknown>

	// Check required top-level fields
	if (file.type !== "excalidraw") {
		errors.push('Missing or invalid "type" field (expected "excalidraw")')
	}

	if (file.version !== 2) {
		warnings.push(`Version is ${file.version}, expected 2`)
	}

	if (!Array.isArray(file.elements)) {
		errors.push('Missing or invalid "elements" array')
	}

	if (!file.appState || typeof file.appState !== "object") {
		errors.push('Missing "appState" object')
	}

	// Validate elements
	const elements = file.elements as ExcalidrawElement[] | undefined
	const ids = new Set<string>()
	let shapes = 0
	let arrows = 0
	let texts = 0

	if (Array.isArray(elements)) {
		for (let i = 0; i < elements.length; i++) {
			const el = elements[i]
			if (!el) continue

			// Check ID
			if (!el.id) {
				errors.push(`Element ${i}: missing "id"`)
			} else if (ids.has(el.id)) {
				errors.push(`Element ${i}: duplicate id "${el.id}"`)
			} else {
				ids.add(el.id)
			}

			// Check type
			if (
				!VALID_ELEMENT_TYPES.includes(
					el.type as (typeof VALID_ELEMENT_TYPES)[number],
				)
			) {
				errors.push(`Element ${i}: invalid type "${el.type}"`)
			}

			// Check coordinates
			if (typeof el.x !== "number" || typeof el.y !== "number") {
				errors.push(`Element ${i} (${el.id}): missing or invalid x/y`)
			}

			if (typeof el.width !== "number" || typeof el.height !== "number") {
				errors.push(`Element ${i} (${el.id}): missing or invalid width/height`)
			}

			// Type-specific validation
			if (el.type === "text") {
				texts++
				const textEl = el as { text?: string; fontSize?: number }
				if (typeof textEl.text !== "string") {
					errors.push(`Text element ${el.id}: missing "text" property`)
				}
				if (typeof textEl.fontSize !== "number") {
					errors.push(`Text element ${el.id}: missing "fontSize"`)
				}
			}

			if (el.type === "arrow") {
				arrows++
				const arrowEl = el as {
					points?: unknown
					startBinding?: { elementId: string }
					endBinding?: { elementId: string }
				}
				if (!Array.isArray(arrowEl.points)) {
					errors.push(`Arrow element ${el.id}: missing "points" array`)
				}
			}

			if (
				el.type === "rectangle" ||
				el.type === "ellipse" ||
				el.type === "diamond"
			) {
				shapes++
			}

			// Check required fields for all elements
			if (typeof el.strokeColor !== "string") {
				warnings.push(`Element ${el.id}: missing strokeColor`)
			}
			if (typeof el.backgroundColor !== "string") {
				warnings.push(`Element ${el.id}: missing backgroundColor`)
			}
		}
	}

	// Check arrow bindings reference valid elements
	if (Array.isArray(elements)) {
		for (const el of elements) {
			if (el?.type === "arrow") {
				const arrowEl = el as {
					startBinding?: { elementId: string } | null
					endBinding?: { elementId: string } | null
				}
				if (arrowEl.startBinding && !ids.has(arrowEl.startBinding.elementId)) {
					warnings.push(
						`Arrow ${el.id}: startBinding references non-existent element "${arrowEl.startBinding.elementId}"`,
					)
				}
				if (arrowEl.endBinding && !ids.has(arrowEl.endBinding.elementId)) {
					warnings.push(
						`Arrow ${el.id}: endBinding references non-existent element "${arrowEl.endBinding.elementId}"`,
					)
				}
			}

			// Check boundElements references
			if (el?.boundElements && Array.isArray(el.boundElements)) {
				for (const bound of el.boundElements) {
					if (!ids.has(bound.id)) {
						warnings.push(
							`Element ${el.id}: boundElement "${bound.id}" not found`,
						)
					}
				}
			}
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings,
		stats: {
			totalElements: elements?.length ?? 0,
			shapes,
			arrows,
			texts,
		},
	}
}

/**
 * Check if an Excalidraw file is valid
 */
export function isValidExcalidraw(data: unknown): data is ExcalidrawFile {
	const result = validateExcalidraw(data)
	return result.valid
}
