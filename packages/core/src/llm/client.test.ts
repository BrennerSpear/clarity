import { describe, expect, test } from "bun:test"
import { parseJsonResponse } from "./client"

describe("parseJsonResponse", () => {
	test("parses plain JSON", () => {
		const response = '{"key": "value", "num": 42}'
		const result = parseJsonResponse<{ key: string; num: number }>(response)

		expect(result.key).toBe("value")
		expect(result.num).toBe(42)
	})

	test("parses JSON from markdown code block", () => {
		const response = `Here is the response:

\`\`\`json
{
  "services": [
    {"id": "test", "category": "data-layer"}
  ]
}
\`\`\`

That's the analysis.`

		const result = parseJsonResponse<{
			services: { id: string; category: string }[]
		}>(response)

		expect(result.services).toHaveLength(1)
		expect(result.services[0]?.id).toBe("test")
	})

	test("parses JSON from untagged code block", () => {
		const response = `\`\`\`
{"items": [1, 2, 3]}
\`\`\``

		const result = parseJsonResponse<{ items: number[] }>(response)
		expect(result.items).toEqual([1, 2, 3])
	})

	test("extracts JSON object from mixed text", () => {
		const response = `Based on my analysis, here's what I found:

The services can be categorized as {"result": "success", "count": 5}

Let me know if you need more details.`

		const result = parseJsonResponse<{ result: string; count: number }>(
			response,
		)
		expect(result.result).toBe("success")
		expect(result.count).toBe(5)
	})

	test("extracts JSON array from mixed text", () => {
		const response = `The categories are: [{"name": "A"}, {"name": "B"}]`

		const result = parseJsonResponse<{ name: string }[]>(response)
		expect(result).toHaveLength(2)
		expect(result[0]?.name).toBe("A")
	})

	test("throws on empty response", () => {
		expect(() => parseJsonResponse("")).toThrow("Empty response")
	})

	test("throws on invalid JSON", () => {
		const response = "This is just plain text without any JSON"
		expect(() => parseJsonResponse(response)).toThrow("Failed to parse JSON")
	})

	test("handles nested JSON objects", () => {
		const response = `\`\`\`json
{
  "services": [
    {
      "id": "postgres",
      "category": "data-layer",
      "description": "Primary database",
      "group": "Data Stores"
    }
  ],
  "groups": [
    {
      "name": "Data Stores",
      "description": "Database and cache services"
    }
  ]
}
\`\`\``

		const result = parseJsonResponse<{
			services: {
				id: string
				category: string
				description: string
				group: string
			}[]
			groups: { name: string; description: string }[]
		}>(response)

		expect(result.services).toHaveLength(1)
		expect(result.services[0]?.id).toBe("postgres")
		expect(result.groups).toHaveLength(1)
		expect(result.groups[0]?.name).toBe("Data Stores")
	})

	test("handles whitespace in code blocks", () => {
		const response = `\`\`\`json

  {
    "test": true
  }

\`\`\``

		const result = parseJsonResponse<{ test: boolean }>(response)
		expect(result.test).toBe(true)
	})
})
