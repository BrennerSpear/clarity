import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { GraphBuilder } from "../graph/builder"
import type { DependencyType, InfraGraph, PortMapping, ServiceType } from "../graph/types"
import { inferServiceType } from "./utils"

export interface TerraformSourceFile {
	path: string
	content: string
}

export interface TerraformParseOptions {
	includeDataSources?: boolean
	includeModules?: boolean
	/** Include infrastructure resources (VPC, IAM, security groups, etc). Default: false */
	includeInfrastructure?: boolean
}

type TerraformBlockKind = "resource" | "data" | "module"

/**
 * Resource types that are infrastructure-level and filtered out by default.
 * These are networking, IAM, and other low-level resources that don't represent
 * application services.
 */
const INFRASTRUCTURE_RESOURCE_PATTERNS: (string | RegExp)[] = [
	// Networking
	"_vpc",
	"_subnet",
	"_route_table",
	"_internet_gateway",
	"_nat_gateway",
	"_network_acl",
	"_network_interface",
	"_eip",
	"_vpn",
	"_transit_gateway",
	"_peering",
	// Security
	"_security_group",
	"_firewall",
	"_waf",
	// IAM / Identity
	"_iam_",
	"_service_account",
	"_role",
	"_policy",
	// Load balancers (infrastructure, not application)
	"_lb",
	"_alb",
	"_elb",
	"_nlb",
	"_listener",
	"_target_group",
	// CDN (infrastructure)
	"_cloudfront",
	"_cdn",
	// Database internals
	"_db_subnet_group",
	"_db_parameter_group",
	"_db_option_group",
	"_elasticache_subnet_group",
	"_elasticache_parameter_group",
	// Container/compute internals (keep only services, filter task definitions and clusters)
	"_ecs_cluster",
	"_ecs_task_definition",
	"_launch_configuration",
	"_launch_template",
	"_autoscaling_group",
	"_instance_profile",
	/aws_instance$/i, // EC2 instances are infrastructure (regex for exact match)
	// Logging/monitoring internals
	"_cloudwatch",
	"_flow_log",
	// Container registry
	"_ecr_repository",
	"_container_registry",
	// DNS
	"_route53",
	"_dns",
	// Certificates
	"_acm_certificate",
	"_certificate",
	// Storage internals (keep buckets, filter policies)
	"_s3_bucket_policy",
	"_s3_bucket_acl",
	"_s3_bucket_versioning",
]

interface TerraformBlock {
	kind: TerraformBlockKind
	type?: string
	name: string
	body: string
	jsonBody?: unknown
	file: string
	line?: number
}

const DEFAULT_OPTIONS: Required<TerraformParseOptions> = {
	includeDataSources: false,
	includeModules: false,
	includeInfrastructure: false,
}

function isInfrastructureResource(resourceType: string): boolean {
	const lower = resourceType.toLowerCase()
	return INFRASTRUCTURE_RESOURCE_PATTERNS.some((pattern) => {
		if (pattern instanceof RegExp) {
			return pattern.test(lower)
		}
		return lower.includes(pattern)
	})
}

const GENERIC_NAMES = new Set(["this", "main", "default"])
const IGNORE_REFERENCE_PREFIXES = new Set([
	"var",
	"local",
	"locals",
	"path",
	"terraform",
	"each",
	"count",
	"self",
])

const DISPLAY_NAME_KEYS = [
	"name",
	"bucket",
	"cluster_name",
	"identifier",
	"service_name",
	"function_name",
	"display_name",
	"project",
]

const IMAGE_KEYS = ["image", "container_image", "image_uri", "repository"]

const PORT_KEYS = [
	"port",
	"container_port",
	"target_port",
	"listener_port",
	"backend_port",
	"service_port",
]

const REPLICA_KEYS = ["replicas", "desired_count", "min_size", "max_size"]
const STORAGE_KEYS = [
	"storage_size",
	"allocated_storage",
	"volume_size",
	"disk_size",
	"size_gb",
]

const NETWORK_EDGE_KEYWORDS = [
	"subnet",
	"vpc",
	"network",
	"security_group",
	"sg",
	"firewall",
	"route",
	"gateway",
	"nat",
	"ingress",
	"load_balancer",
	"lb",
	"alb",
	"elb",
]

const VOLUME_EDGE_KEYWORDS = ["volume", "disk", "ebs", "efs", "filestore"]

const QUEUE_KEYWORDS = [
	"queue",
	"sqs",
	"pubsub",
	"kinesis",
	"eventhub",
	"servicebus",
	"rabbitmq",
	"kafka",
	"nats",
	"mq",
]

const CACHE_KEYWORDS = [
	"redis",
	"memcache",
	"memcached",
	"elasticache",
	"cache",
]

const DATABASE_KEYWORDS = [
	"postgres",
	"mysql",
	"mariadb",
	"oracle",
	"sql",
	"db",
	"database",
	"rds",
	"dynamodb",
	"cosmosdb",
	"cassandra",
	"mongo",
	"aurora",
]

const STORAGE_KEYWORDS = [
	"s3",
	"bucket",
	"storage",
	"blob",
	"efs",
	"filestore",
	"object",
	"volume",
]

const PROXY_KEYWORDS = [
	"load_balancer",
	"alb",
	"elb",
	"lb",
	"ingress",
	"gateway",
	"api_gateway",
	"cloudfront",
	"cdn",
	"front_door",
]

const UI_KEYWORDS = ["frontend", "ui", "web", "portal", "dashboard", "console"]

function isTerraformConfigFile(path: string): boolean {
	const lower = path.toLowerCase()
	if (lower.endsWith(".tf.json")) {
		return !lower.includes(".tfvars")
	}
	if (lower.endsWith(".tf")) {
		return !lower.includes(".tfvars")
	}
	return false
}

function isIdentifierChar(value: string): boolean {
	return /[A-Za-z0-9_-]/.test(value)
}

function skipLineComment(
	content: string,
	index: number,
	line: number,
): { index: number; line: number } {
	const nextNewline = content.indexOf("\n", index)
	if (nextNewline === -1) {
		return { index: content.length, line }
	}
	return { index: nextNewline + 1, line: line + 1 }
}

function skipBlockComment(
	content: string,
	index: number,
	line: number,
): { index: number; line: number } {
	const end = content.indexOf("*/", index + 2)
	const slice = end === -1 ? content.slice(index + 2) : content.slice(index + 2, end)
	const newlineCount = slice.split("\n").length - 1
	return {
		index: end === -1 ? content.length : end + 2,
		line: line + newlineCount,
	}
}

function skipString(
	content: string,
	index: number,
	line: number,
	quote: string,
): { index: number; line: number } {
	let i = index + 1
	let currentLine = line
	while (i < content.length) {
		const ch = content[i]
		if (ch === "\\") {
			i += 2
			continue
		}
		if (ch === quote) {
			return { index: i + 1, line: currentLine }
		}
		if (ch === "\n") {
			currentLine += 1
		}
		i += 1
	}
	return { index: content.length, line: currentLine }
}

function skipHeredoc(
	content: string,
	index: number,
	line: number,
): { index: number; line: number } {
	let i = index + 2
	let stripIndent = false
	if (content[i] === "-") {
		stripIndent = true
		i += 1
	}
	let delimiter = ""
	while (i < content.length && !/\s/.test(content[i] ?? "")) {
		delimiter += content[i]
		i += 1
	}
	if (!delimiter) {
		return { index: index + 1, line }
	}
	while (i < content.length && content[i] !== "\n") {
		i += 1
	}
	if (i < content.length && content[i] === "\n") {
		i += 1
		line += 1
	}
	while (i < content.length) {
		const lineEnd = content.indexOf("\n", i)
		const sliceEnd = lineEnd === -1 ? content.length : lineEnd
		const lineText = content.slice(i, sliceEnd)
		const compare = stripIndent ? lineText.trim() : lineText
		if (compare === delimiter) {
			const nextIndex = lineEnd === -1 ? content.length : lineEnd + 1
			return { index: nextIndex, line: line + 1 }
		}
		i = lineEnd === -1 ? content.length : lineEnd + 1
		line += 1
	}
	return { index: content.length, line }
}

function skipTrivia(
	content: string,
	index: number,
	line: number,
): { index: number; line: number } {
	let i = index
	let currentLine = line
	while (i < content.length) {
		const ch = content[i]
		if (ch === " " || ch === "\t" || ch === "\r") {
			i += 1
			continue
		}
		if (ch === "\n") {
			currentLine += 1
			i += 1
			continue
		}
		if (ch === "#") {
			const skipped = skipLineComment(content, i, currentLine)
			i = skipped.index
			currentLine = skipped.line
			continue
		}
		if (ch === "/" && content[i + 1] === "/") {
			const skipped = skipLineComment(content, i, currentLine)
			i = skipped.index
			currentLine = skipped.line
			continue
		}
		if (ch === "/" && content[i + 1] === "*") {
			const skipped = skipBlockComment(content, i, currentLine)
			i = skipped.index
			currentLine = skipped.line
			continue
		}
		break
	}
	return { index: i, line: currentLine }
}

function readQuotedString(
	content: string,
	index: number,
	line: number,
): { value: string; index: number; line: number } | null {
	const quote = content[index]
	if (quote !== "\"" && quote !== "'") return null
	let i = index + 1
	let currentLine = line
	let value = ""
	while (i < content.length) {
		const ch = content[i]
		if (ch === "\\") {
			const next = content[i + 1]
			if (next) {
				value += next
				i += 2
				continue
			}
		}
		if (ch === quote) {
			return { value, index: i + 1, line: currentLine }
		}
		if (ch === "\n") {
			currentLine += 1
		}
		value += ch
		i += 1
	}
	return null
}

function scanBlockBody(
	content: string,
	startIndex: number,
	line: number,
): { body: string; endIndex: number; line: number } {
	let depth = 1
	let i = startIndex + 1
	let currentLine = line
	const bodyStart = startIndex + 1
	while (i < content.length) {
		const ch = content[i]
		if (ch === "\n") {
			currentLine += 1
			i += 1
			continue
		}
		if (ch === "#" || (ch === "/" && content[i + 1] === "/")) {
			const skipped = skipLineComment(content, i, currentLine)
			i = skipped.index
			currentLine = skipped.line
			continue
		}
		if (ch === "/" && content[i + 1] === "*") {
			const skipped = skipBlockComment(content, i, currentLine)
			i = skipped.index
			currentLine = skipped.line
			continue
		}
		if (ch === "\"" || ch === "'") {
			const skipped = skipString(content, i, currentLine, ch)
			i = skipped.index
			currentLine = skipped.line
			continue
		}
		if (ch === "<" && content[i + 1] === "<") {
			const skipped = skipHeredoc(content, i, currentLine)
			i = skipped.index
			currentLine = skipped.line
			continue
		}
		if (ch === "{") {
			depth += 1
		}
		if (ch === "}") {
			depth -= 1
			if (depth === 0) {
				const body = content.slice(bodyStart, i)
				return { body, endIndex: i, line: currentLine }
			}
		}
		i += 1
	}
	return { body: content.slice(bodyStart), endIndex: content.length, line: currentLine }
}

function parseHclBlocks(content: string, filename: string): TerraformBlock[] {
	const blocks: TerraformBlock[] = []
	let index = 0
	let line = 1
	while (index < content.length) {
		const ch = content[index]
		if (ch === "\n") {
			line += 1
			index += 1
			continue
		}
		if (ch === "#" || (ch === "/" && content[index + 1] === "/")) {
			const skipped = skipLineComment(content, index, line)
			index = skipped.index
			line = skipped.line
			continue
		}
		if (ch === "/" && content[index + 1] === "*") {
			const skipped = skipBlockComment(content, index, line)
			index = skipped.index
			line = skipped.line
			continue
		}
		if (ch === "\"" || ch === "'") {
			const skipped = skipString(content, index, line, ch)
			index = skipped.index
			line = skipped.line
			continue
		}
		if (ch === "<" && content[index + 1] === "<") {
			const skipped = skipHeredoc(content, index, line)
			index = skipped.index
			line = skipped.line
			continue
		}

		const remaining = content.slice(index)
		const keywordMatch = remaining.match(/^(resource|data|module)\b/)
		if (!keywordMatch) {
			index += 1
			continue
		}
		const prevChar = index > 0 ? content[index - 1] : undefined
		if (prevChar && isIdentifierChar(prevChar)) {
			index += 1
			continue
		}

		const kind = keywordMatch[1] as TerraformBlockKind
		const keywordStart = index
		index += kind.length
		const afterKeyword = skipTrivia(content, index, line)
		index = afterKeyword.index
		line = afterKeyword.line
		const firstLabel = readQuotedString(content, index, line)
		if (!firstLabel) {
			index = keywordStart + 1
			continue
		}
		index = firstLabel.index
		line = firstLabel.line
		let resourceType: string | undefined
		let name = firstLabel.value

		if (kind !== "module") {
			resourceType = firstLabel.value
			const afterType = skipTrivia(content, index, line)
			index = afterType.index
			line = afterType.line
			const secondLabel = readQuotedString(content, index, line)
			if (!secondLabel) {
				index = keywordStart + 1
				continue
			}
			index = secondLabel.index
			line = secondLabel.line
			name = secondLabel.value
		}

		const beforeBrace = skipTrivia(content, index, line)
		index = beforeBrace.index
		line = beforeBrace.line
		if (content[index] !== "{") {
			index = keywordStart + 1
			continue
		}

		const blockLine = line
		const bodyResult = scanBlockBody(content, index, line)
		const body = bodyResult.body
		const endIndex = bodyResult.endIndex
		line = bodyResult.line
		index = endIndex + 1

		blocks.push({
			kind,
			type: resourceType,
			name,
			body,
			file: filename,
			line: blockLine,
		})
	}
	return blocks
}

function parseJsonBlocks(content: string, filename: string): TerraformBlock[] {
	const blocks: TerraformBlock[] = []
	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch {
		return blocks
	}

	if (!parsed || typeof parsed !== "object") return blocks
	const root = parsed as Record<string, unknown>
	const resourceRoot = root.resource
	if (resourceRoot && typeof resourceRoot === "object") {
		for (const [type, resources] of Object.entries(resourceRoot)) {
			if (!resources || typeof resources !== "object") continue
			for (const [name, body] of Object.entries(resources as Record<string, unknown>)) {
				blocks.push({
					kind: "resource",
					type,
					name,
					body: JSON.stringify(body ?? {}),
					jsonBody: body,
					file: filename,
				})
			}
		}
	}

	const dataRoot = root.data
	if (dataRoot && typeof dataRoot === "object") {
		for (const [type, resources] of Object.entries(dataRoot)) {
			if (!resources || typeof resources !== "object") continue
			for (const [name, body] of Object.entries(resources as Record<string, unknown>)) {
				blocks.push({
					kind: "data",
					type,
					name,
					body: JSON.stringify(body ?? {}),
					jsonBody: body,
					file: filename,
				})
			}
		}
	}

	const moduleRoot = root.module
	if (moduleRoot && typeof moduleRoot === "object") {
		for (const [name, body] of Object.entries(moduleRoot)) {
			blocks.push({
				kind: "module",
				name,
				body: JSON.stringify(body ?? {}),
				jsonBody: body,
				file: filename,
			})
		}
	}

	return blocks
}

function extractStringAttributeFromBody(
	body: string,
	keys: string[],
): string | undefined {
	for (const key of keys) {
		const regex = new RegExp(`\\b${key}\\s*=\\s*["']([^"']+)["']`, "i")
		const match = body.match(regex)
		if (match?.[1]) {
			return match[1]
		}
	}
	return undefined
}

function extractNumberAttributeFromBody(
	body: string,
	keys: string[],
): number | undefined {
	for (const key of keys) {
		const regex = new RegExp(`\\b${key}\\s*=\\s*["']?(\\d+)["']?`, "i")
		const match = body.match(regex)
		if (match?.[1]) {
			const value = Number.parseInt(match[1], 10)
			if (!Number.isNaN(value)) return value
		}
	}
	return undefined
}

function extractNumberArrayFromBody(
	body: string,
	keys: string[],
): number[] {
	const results: number[] = []
	for (const key of keys) {
		const regex = new RegExp(`\\b${key}\\s*=\\s*["']?(\\d+)["']?`, "gi")
		for (const match of body.matchAll(regex)) {
			if (match?.[1]) {
				const value = Number.parseInt(match[1], 10)
				if (!Number.isNaN(value)) results.push(value)
			}
		}
	}
	return results
}

function extractStringAttributeFromJson(
	body: unknown,
	keys: string[],
): string | undefined {
	if (!body || typeof body !== "object") return undefined
	const record = body as Record<string, unknown>
	for (const key of keys) {
		const value = record[key]
		if (typeof value === "string") return value
	}
	return undefined
}

function extractNumberAttributeFromJson(
	body: unknown,
	keys: string[],
): number | undefined {
	if (!body || typeof body !== "object") return undefined
	const record = body as Record<string, unknown>
	for (const key of keys) {
		const value = record[key]
		if (typeof value === "number") return value
		if (typeof value === "string") {
			const parsed = Number.parseInt(value, 10)
			if (!Number.isNaN(parsed)) return parsed
		}
	}
	return undefined
}

function extractPortMappings(body: string, jsonBody?: unknown): PortMapping[] | undefined {
	const ports = new Set<number>()
	for (const port of extractNumberArrayFromBody(body, PORT_KEYS)) {
		ports.add(port)
	}
	if (jsonBody) {
		const fromJson = extractNumberAttributeFromJson(jsonBody, PORT_KEYS)
		if (fromJson !== undefined) ports.add(fromJson)
	}
	if (ports.size === 0) return undefined
	return Array.from(ports).map((port) => ({ internal: port }))
}

function shouldUseDisplayName(value: string | undefined): boolean {
	if (!value) return false
	const trimmed = value.trim()
	if (!trimmed) return false
	if (trimmed.includes("${")) return false
	if (trimmed.startsWith("var.") || trimmed.startsWith("local.")) return false
	return true
}

function buildBlockId(block: TerraformBlock): string {
	if (block.kind === "module") {
		return `module.${block.name}`
	}
	if (block.kind === "data") {
		return `data.${block.type ?? "unknown"}.${block.name}`
	}
	return `${block.type ?? "unknown"}.${block.name}`
}

function buildDisplayName(block: TerraformBlock): string {
	if (block.kind === "module") {
		return `module.${block.name}`
	}

	// For data stores, prioritize descriptive names based on resource type
	const resourceType = block.type?.toLowerCase() ?? ""
	if (resourceType.includes("db_instance") || resourceType.includes("rds")) {
		// Try descriptive attributes in order of preference
		const dbKeys = ["db_name", "identifier", "cluster_identifier", "name"]
		const dbName = block.jsonBody
			? extractStringAttributeFromJson(block.jsonBody, dbKeys)
			: extractStringAttributeFromBody(block.body, dbKeys)
		if (dbName && shouldUseDisplayName(dbName)) return dbName
		// Fall back to engine type
		const engine = block.jsonBody
			? extractStringAttributeFromJson(block.jsonBody, ["engine"])
			: extractStringAttributeFromBody(block.body, ["engine"])
		if (engine && shouldUseDisplayName(engine)) return engine
		return "db"
	}
	if (resourceType.includes("elasticache") || resourceType.includes("redis") || resourceType.includes("memcache")) {
		// Try descriptive attributes in order of preference
		const cacheKeys = ["cluster_id", "replication_group_id", "name"]
		const cacheName = block.jsonBody
			? extractStringAttributeFromJson(block.jsonBody, cacheKeys)
			: extractStringAttributeFromBody(block.body, cacheKeys)
		if (cacheName && shouldUseDisplayName(cacheName)) return cacheName
		// Fall back to engine type
		const engine = block.jsonBody
			? extractStringAttributeFromJson(block.jsonBody, ["engine"])
			: extractStringAttributeFromBody(block.body, ["engine"])
		if (engine && shouldUseDisplayName(engine)) return engine
		return "cache"
	}
	if (resourceType.includes("s3_bucket")) {
		// Try bucket attribute first, fall back to resource name
		const bucketAttr = block.jsonBody
			? extractStringAttributeFromJson(block.jsonBody, ["bucket"])
			: extractStringAttributeFromBody(block.body, ["bucket"])
		if (bucketAttr && shouldUseDisplayName(bucketAttr)) return bucketAttr
		return block.name
	}

	// For other resources, try to extract a display name from body attributes
	const fallback = buildBlockId(block)
	const candidate = block.jsonBody
		? extractStringAttributeFromJson(block.jsonBody, DISPLAY_NAME_KEYS)
		: extractStringAttributeFromBody(block.body, DISPLAY_NAME_KEYS)
	const fromBody = shouldUseDisplayName(candidate) ? candidate : undefined
	if (fromBody) return fromBody
	if (GENERIC_NAMES.has(block.name.toLowerCase())) return fallback

	return block.name
}

/**
 * Simplify service name by stripping common project prefix.
 * e.g., "mastodon_rails_puma" → "rails_puma"
 */
function simplifyServiceName(name: string, projectPrefix: string): string {
	const nameLower = name.toLowerCase()
	const prefixLower = projectPrefix.toLowerCase()
	if (nameLower.startsWith(`${prefixLower}_`) || nameLower.startsWith(`${prefixLower}-`)) {
		return name.slice(projectPrefix.length + 1)
	}
	return name
}

function inferTerraformServiceType(resourceType: string, resourceName: string): ServiceType {
	const haystack = `${resourceType} ${resourceName}`.toLowerCase()
	for (const keyword of QUEUE_KEYWORDS) {
		if (haystack.includes(keyword)) return "queue"
	}
	for (const keyword of CACHE_KEYWORDS) {
		if (haystack.includes(keyword)) return "cache"
	}
	for (const keyword of DATABASE_KEYWORDS) {
		if (haystack.includes(keyword)) return "database"
	}
	for (const keyword of STORAGE_KEYWORDS) {
		if (haystack.includes(keyword)) return "storage"
	}
	for (const keyword of PROXY_KEYWORDS) {
		if (haystack.includes(keyword)) return "proxy"
	}
	for (const keyword of UI_KEYWORDS) {
		if (haystack.includes(keyword)) return "ui"
	}
	return inferServiceType(resourceName, resourceType)
}

function inferDependencyType(resourceType?: string): DependencyType {
	if (!resourceType) return "inferred"
	const haystack = resourceType.toLowerCase()
	for (const keyword of NETWORK_EDGE_KEYWORDS) {
		if (haystack.includes(keyword)) return "network"
	}
	for (const keyword of VOLUME_EDGE_KEYWORDS) {
		if (haystack.includes(keyword)) return "volume"
	}
	return "inferred"
}

function extractReferencesFromString(value: string): Set<string> {
	const references = new Set<string>()
	const regex = /\b(?:data\.)?[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
	for (const match of value.matchAll(regex)) {
		const token = match[0]
		if (!token) continue
		const prefix = token.split(".")[0]
		if (prefix && IGNORE_REFERENCE_PREFIXES.has(prefix)) continue
		references.add(token)
	}
	return references
}

function extractReferencesFromJson(value: unknown): Set<string> {
	const references = new Set<string>()
	const visit = (current: unknown): void => {
		if (typeof current === "string") {
			for (const ref of extractReferencesFromString(current)) {
				references.add(ref)
			}
			return
		}
		if (Array.isArray(current)) {
			for (const item of current) visit(item)
			return
		}
		if (current && typeof current === "object") {
			for (const item of Object.values(current)) visit(item)
		}
	}
	visit(value)
	return references
}

function extractDependsOnFromBody(body: string): Set<string> {
	const results = new Set<string>()
	const regex = /\bdepends_on\s*=\s*\[([\s\S]*?)\]/gi
	for (const match of body.matchAll(regex)) {
		const segment = match[1] ?? ""
		for (const ref of extractReferencesFromString(segment)) {
			results.add(ref)
		}
	}
	return results
}

function extractDependsOnFromJson(body: unknown): Set<string> {
	const results = new Set<string>()
	if (!body || typeof body !== "object") return results
	const record = body as Record<string, unknown>
	const dependsOn = record.depends_on
	if (Array.isArray(dependsOn)) {
		for (const value of dependsOn) {
			if (typeof value === "string") {
				for (const ref of extractReferencesFromString(value)) {
					results.add(ref)
				}
			}
		}
	}
	return results
}

function buildTerraformGraph(
	blocks: TerraformBlock[],
	project: string,
	options?: TerraformParseOptions,
): InfraGraph {
	const settings = { ...DEFAULT_OPTIONS, ...options }
	const builder = new GraphBuilder(project)

	const nodeInfo = new Map<string, TerraformBlock>()

	// First pass: collect data store names for prefix stripping
	const dataStoreNames = new Set<string>()
	for (const block of blocks) {
		if (block.kind !== "resource") continue
		const resourceType = block.type?.toLowerCase() ?? ""
		if (
			resourceType.includes("db_instance") ||
			resourceType.includes("rds") ||
			resourceType.includes("elasticache") ||
			resourceType.includes("s3_bucket")
		) {
			dataStoreNames.add(block.name.toLowerCase())
		}
	}

	for (const block of blocks) {
		if (block.kind === "data" && !settings.includeDataSources) continue
		if (block.kind === "module" && !settings.includeModules) continue
		// Filter infrastructure resources unless explicitly included
		if (
			block.kind === "resource" &&
			block.type &&
			!settings.includeInfrastructure &&
			isInfrastructureResource(block.type)
		) {
			continue
		}

		const id = buildBlockId(block)
		let name = buildDisplayName(block)

		// Strip data store prefix from service names (e.g., "mastodon_rails_puma" → "rails_puma")
		const resourceType = block.type?.toLowerCase() ?? ""
		const isDataStore =
			resourceType.includes("db_instance") ||
			resourceType.includes("rds") ||
			resourceType.includes("elasticache") ||
			resourceType.includes("s3_bucket")
		if (!isDataStore) {
			for (const prefix of dataStoreNames) {
				const simplified = simplifyServiceName(name, prefix)
				if (simplified !== name) {
					name = simplified
					break
				}
			}
		}
		const type =
			block.kind === "module"
				? "container"
				: inferTerraformServiceType(block.type ?? "", name)

		const image = block.jsonBody
			? extractStringAttributeFromJson(block.jsonBody, IMAGE_KEYS)
			: extractStringAttributeFromBody(block.body, IMAGE_KEYS)
		const ports = extractPortMappings(block.body, block.jsonBody)
		const replicas =
			block.jsonBody !== undefined
				? extractNumberAttributeFromJson(block.jsonBody, REPLICA_KEYS)
				: extractNumberAttributeFromBody(block.body, REPLICA_KEYS)
		const storageValue =
			block.jsonBody !== undefined
				? extractNumberAttributeFromJson(block.jsonBody, STORAGE_KEYS)
				: extractNumberAttributeFromBody(block.body, STORAGE_KEYS)
		const storageSize =
			storageValue !== undefined ? String(storageValue) : undefined
		const moduleSource =
			block.kind === "module"
				? block.jsonBody
						? extractStringAttributeFromJson(block.jsonBody, ["source"])
						: extractStringAttributeFromBody(block.body, ["source"])
				: undefined
		const isExternalModule =
			block.kind === "module" && moduleSource
				? !moduleSource.startsWith("./") &&
					!moduleSource.startsWith("../") &&
					!moduleSource.startsWith("/") &&
					!moduleSource.startsWith("file://")
				: false

		builder.addNode(
			id,
			name,
			type,
			{ file: block.file, format: "terraform", line: block.line },
			{
				image: image && shouldUseDisplayName(image) ? image : undefined,
				ports,
				replicas,
				storageSize,
				external: block.kind === "data" || isExternalModule ? true : undefined,
			},
		)
		nodeInfo.set(id, block)
		builder.addSourceFile(block.file)
	}

	const nodeIds = new Set(nodeInfo.keys())

	for (const block of blocks) {
		if (block.kind === "data" && !settings.includeDataSources) continue
		if (block.kind === "module" && !settings.includeModules) continue

		const fromId = buildBlockId(block)
		if (!nodeIds.has(fromId)) continue
		const explicitDeps = new Set<string>()
		const dependsOn = block.jsonBody
			? extractDependsOnFromJson(block.jsonBody)
			: extractDependsOnFromBody(block.body)
		for (const dep of dependsOn) {
			if (dep === fromId) continue
			if (!nodeIds.has(dep)) continue
			explicitDeps.add(dep)
			builder.addEdge(fromId, dep, "depends_on")
		}

		const references = block.jsonBody
			? extractReferencesFromJson(block.jsonBody)
			: extractReferencesFromString(block.body)
		for (const ref of references) {
			if (ref === fromId) continue
			if (!nodeIds.has(ref)) continue
			if (explicitDeps.has(ref)) continue
			const refBlock = nodeInfo.get(ref)
			const edgeType = inferDependencyType(refBlock?.type)
			builder.addEdge(fromId, ref, edgeType)
		}
	}

	// Infer connections between services and data stores based on shared naming
	const serviceTypes = new Set(["container", "worker", "api", "web", "proxy", "ui"])
	const dataStoreTypes = new Set(["database", "cache", "storage", "queue"])

	const services: { id: string; name: string }[] = []
	const dataStores: { id: string; name: string; type: string }[] = []

	for (const [id, block] of nodeInfo) {
		const type = inferTerraformServiceType(block.type ?? "", block.name)
		if (serviceTypes.has(type)) {
			services.push({ id, name: block.name })
		} else if (dataStoreTypes.has(type)) {
			dataStores.push({ id, name: block.name, type })
		}
	}

	// Extract name prefix (split on underscore, hyphen, or dash)
	const getPrefix = (name: string): string => {
		return name.split(/[_-]/)[0]?.toLowerCase() ?? ""
	}

	// Connect services to data stores with matching name prefixes
	for (const service of services) {
		const servicePrefix = getPrefix(service.name)
		if (servicePrefix.length < 3) continue // Skip short prefixes

		for (const store of dataStores) {
			const storePrefix = getPrefix(store.name)
			if (servicePrefix === storePrefix) {
				const edgeType: DependencyType = store.type === "database" ? "database" : store.type === "cache" ? "cache" : "inferred"
				builder.addEdge(service.id, store.id, edgeType)
			}
		}
	}

	return builder.build()
}

/**
 * Parse Terraform files into an InfraGraph.
 */
export function parseTerraformFiles(
	files: TerraformSourceFile[],
	project: string,
	options?: TerraformParseOptions,
): InfraGraph {
	const blocks: TerraformBlock[] = []
	for (const file of files) {
		if (!isTerraformConfigFile(file.path)) continue
		const lower = file.path.toLowerCase()
		if (lower.endsWith(".tf.json")) {
			blocks.push(...parseJsonBlocks(file.content, file.path))
		} else {
			blocks.push(...parseHclBlocks(file.content, file.path))
		}
	}

	if (blocks.length === 0) {
		return {
			nodes: [],
			edges: [],
			metadata: {
				project,
				parsedAt: new Date().toISOString(),
				sourceFiles: files.map((file) => file.path),
				parserVersion: "0.1.0",
			},
		}
	}

	return buildTerraformGraph(blocks, project, options)
}

/**
 * Recursively collect all Terraform files from a directory and its local modules.
 */
function collectTerraformFiles(
	baseDir: string,
	relativePath: string,
	visited: Set<string>,
): TerraformSourceFile[] {
	const absolutePath = relativePath ? join(baseDir, relativePath) : baseDir

	// Prevent infinite loops from circular module references
	if (visited.has(absolutePath)) return []
	visited.add(absolutePath)

	const files: TerraformSourceFile[] = []
	let entries: { name: string; isFile: () => boolean }[]
	try {
		entries = readdirSync(absolutePath, { withFileTypes: true, encoding: "utf-8" })
	} catch {
		return files
	}

	// First pass: collect .tf files in this directory
	const blocks: TerraformBlock[] = []
	for (const entry of entries) {
		if (!entry.isFile()) continue
		const entryName = entry.name
		const filePath = join(absolutePath, entryName)
		if (!isTerraformConfigFile(filePath)) continue
		const content = readFileSync(filePath, "utf-8")
		const fileRelPath = relativePath ? join(relativePath, entryName) : entryName
		files.push({ path: fileRelPath, content })

		// Parse to find local module references
		if (filePath.toLowerCase().endsWith(".tf.json")) {
			blocks.push(...parseJsonBlocks(content, fileRelPath))
		} else {
			blocks.push(...parseHclBlocks(content, fileRelPath))
		}
	}

	// Second pass: recurse into local modules
	for (const block of blocks) {
		if (block.kind !== "module") continue

		const source = block.jsonBody
			? extractStringAttributeFromJson(block.jsonBody, ["source"])
			: extractStringAttributeFromBody(block.body, ["source"])

		if (!source) continue

		// Only follow local module references
		if (!source.startsWith("./") && !source.startsWith("../")) continue

		const modulePath = relativePath ? join(relativePath, source) : source
		const nestedFiles = collectTerraformFiles(baseDir, modulePath, visited)
		files.push(...nestedFiles)
	}

	return files
}

/**
 * Parse a Terraform module directory into an InfraGraph.
 * Recursively includes local modules referenced via source = "./path".
 */
export function parseTerraformModule(
	moduleDir: string,
	project: string,
	options?: TerraformParseOptions,
): InfraGraph {
	const visited = new Set<string>()
	const files = collectTerraformFiles(moduleDir, "", visited)
	return parseTerraformFiles(files, project, options)
}

export function isTerraformPath(path: string): boolean {
	return isTerraformConfigFile(path)
}
