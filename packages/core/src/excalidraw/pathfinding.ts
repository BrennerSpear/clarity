/**
 * A* pathfinding for orthogonal arrow routing
 *
 * Creates a grid, marks obstacles (nodes), and finds paths around them.
 * Tracks existing arrow paths to spread parallel arrows apart.
 */

import type { NodePosition } from "./layout"

/**
 * Grid cell state
 */
type CellState = "empty" | "obstacle" | "padding" | "arrow"

/**
 * Grid for pathfinding
 */
export interface Grid {
	cells: CellState[][]
	width: number
	height: number
	cellSize: number
	offsetX: number
	offsetY: number
	/** Count of arrows passing through each cell */
	arrowUsage: Map<string, number>
}

/**
 * A* node
 */
interface AStarNode {
	x: number
	y: number
	g: number // Cost from start
	h: number // Heuristic (estimated cost to end)
	f: number // Total cost (g + h)
	parent: AStarNode | null
	direction: "up" | "down" | "left" | "right" | null
}

/**
 * Create a grid from node positions
 */
export function createGrid(
	positions: Map<string, NodePosition>,
	cellSize = 8, // Smaller cells for finer resolution
	padding = 100, // More padding around diagram edges
): Grid {
	if (positions.size === 0) {
		return {
			cells: [[]],
			width: 1,
			height: 1,
			cellSize,
			offsetX: 0,
			offsetY: 0,
			arrowUsage: new Map(),
		}
	}

	// Find bounds
	let minX = Infinity,
		minY = Infinity
	let maxX = -Infinity,
		maxY = -Infinity

	for (const pos of positions.values()) {
		minX = Math.min(minX, pos.x - padding)
		minY = Math.min(minY, pos.y - padding)
		maxX = Math.max(maxX, pos.x + pos.width + padding)
		maxY = Math.max(maxY, pos.y + pos.height + padding)
	}

	const width = Math.ceil((maxX - minX) / cellSize) + 2
	const height = Math.ceil((maxY - minY) / cellSize) + 2

	// Initialize grid
	const cells: CellState[][] = []
	for (let y = 0; y < height; y++) {
		const row: CellState[] = []
		cells[y] = row
		for (let x = 0; x < width; x++) {
			row[x] = "empty"
		}
	}

	// Mark obstacles (nodes) and padding around them
	for (const pos of positions.values()) {
		// Add substantial margin around nodes to ensure arrows don't cross them
		const margin = 10
		const startX = Math.floor((pos.x - margin - minX) / cellSize)
		const startY = Math.floor((pos.y - margin - minY) / cellSize)
		const endX = Math.ceil((pos.x + pos.width + margin - minX) / cellSize)
		const endY = Math.ceil((pos.y + pos.height + margin - minY) / cellSize)

		// Mark the node itself as obstacle (completely impassable)
		for (let y = startY; y <= endY; y++) {
			for (let x = startX; x <= endX; x++) {
				if (y >= 0 && y < height && x >= 0 && x < width) {
					cells[y]![x] = "obstacle"
				}
			}
		}

		// Mark larger padding around the node (6-cell buffer for better spacing)
		const paddingCells = 6
		for (let y = startY - paddingCells; y <= endY + paddingCells; y++) {
			for (let x = startX - paddingCells; x <= endX + paddingCells; x++) {
				if (y >= 0 && y < height && x >= 0 && x < width) {
					if (cells[y]![x] === "empty") {
						cells[y]![x] = "padding"
					}
				}
			}
		}
	}

	return {
		cells,
		width,
		height,
		cellSize,
		offsetX: minX,
		offsetY: minY,
		arrowUsage: new Map(),
	}
}

/**
 * Convert world coordinates to grid coordinates
 */
function worldToGrid(
	grid: Grid,
	x: number,
	y: number,
): { gx: number; gy: number } {
	return {
		gx: Math.round((x - grid.offsetX) / grid.cellSize),
		gy: Math.round((y - grid.offsetY) / grid.cellSize),
	}
}

/**
 * Convert grid coordinates to world coordinates
 */
function gridToWorld(
	grid: Grid,
	gx: number,
	gy: number,
): { x: number; y: number } {
	return {
		x: gx * grid.cellSize + grid.offsetX,
		y: gy * grid.cellSize + grid.offsetY,
	}
}

/**
 * Manhattan distance heuristic
 */
function heuristic(x1: number, y1: number, x2: number, y2: number): number {
	return Math.abs(x2 - x1) + Math.abs(y2 - y1)
}

/**
 * Get direction between two points
 */
function getDirection(
	fromX: number,
	fromY: number,
	toX: number,
	toY: number,
): "up" | "down" | "left" | "right" {
	const dx = toX - fromX
	const dy = toY - fromY
	if (dy < 0) return "up"
	if (dy > 0) return "down"
	if (dx < 0) return "left"
	return "right"
}

/**
 * Get neighbors (orthogonal only - up, down, left, right)
 */
function getNeighbors(
	grid: Grid,
	node: AStarNode,
): { x: number; y: number; direction: "up" | "down" | "left" | "right" }[] {
	const neighbors: {
		x: number
		y: number
		direction: "up" | "down" | "left" | "right"
	}[] = []
	const dirs: {
		dx: number
		dy: number
		dir: "up" | "down" | "left" | "right"
	}[] = [
		{ dx: 0, dy: -1, dir: "up" },
		{ dx: 0, dy: 1, dir: "down" },
		{ dx: -1, dy: 0, dir: "left" },
		{ dx: 1, dy: 0, dir: "right" },
	]

	for (const { dx, dy, dir } of dirs) {
		const nx = node.x + dx
		const ny = node.y + dy

		if (nx >= 0 && nx < grid.width && ny >= 0 && ny < grid.height) {
			const cell = grid.cells[ny]?.[nx]
			// Only allow empty, padding, and arrow cells (not obstacles)
			if (cell !== "obstacle") {
				neighbors.push({ x: nx, y: ny, direction: dir })
			}
		}
	}

	return neighbors
}

/**
 * Check if two points are on the same line (for path simplification)
 */
function isCollinear(
	p1: [number, number],
	p2: [number, number],
	p3: [number, number],
): boolean {
	return (
		(p1[0] === p2[0] && p2[0] === p3[0]) || (p1[1] === p2[1] && p2[1] === p3[1])
	)
}

/**
 * Simplify path by removing redundant points
 */
function simplifyPath(path: [number, number][]): [number, number][] {
	if (path.length <= 2) return path

	const simplified: [number, number][] = [path[0]!]

	for (let i = 1; i < path.length - 1; i++) {
		const prev = simplified[simplified.length - 1]!
		const curr = path[i]!
		const next = path[i + 1]!

		// Only keep point if it's a corner (direction changes)
		if (!isCollinear(prev, curr, next)) {
			simplified.push(curr)
		}
	}

	simplified.push(path[path.length - 1]!)
	return simplified
}

/**
 * Find nearest traversable cell to a position
 */
function findNearestEmpty(
	grid: Grid,
	gx: number,
	gy: number,
): { gx: number; gy: number } {
	// Check if already traversable
	if (gx >= 0 && gx < grid.width && gy >= 0 && gy < grid.height) {
		const cell = grid.cells[gy]?.[gx]
		if (cell !== "obstacle") {
			return { gx, gy }
		}
	}

	// Search in expanding rings
	for (let radius = 1; radius < Math.max(grid.width, grid.height); radius++) {
		for (let dy = -radius; dy <= radius; dy++) {
			for (let dx = -radius; dx <= radius; dx++) {
				if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue // Only check ring

				const nx = gx + dx
				const ny = gy + dy

				if (nx >= 0 && nx < grid.width && ny >= 0 && ny < grid.height) {
					const cell = grid.cells[ny]?.[nx]
					if (cell !== "obstacle") {
						return { gx: nx, gy: ny }
					}
				}
			}
		}
	}

	return { gx, gy } // Fallback
}

/**
 * A* pathfinding
 */
export function findPath(
	grid: Grid,
	startX: number,
	startY: number,
	endX: number,
	endY: number,
): [number, number][] | null {
	let start = worldToGrid(grid, startX, startY)
	let end = worldToGrid(grid, endX, endY)

	// Clamp to grid bounds
	start.gx = Math.max(0, Math.min(grid.width - 1, start.gx))
	start.gy = Math.max(0, Math.min(grid.height - 1, start.gy))
	end.gx = Math.max(0, Math.min(grid.width - 1, end.gx))
	end.gy = Math.max(0, Math.min(grid.height - 1, end.gy))

	// Find nearest traversable cells if start/end are in obstacles
	start = findNearestEmpty(grid, start.gx, start.gy)
	end = findNearestEmpty(grid, end.gx, end.gy)

	const openSet: AStarNode[] = []
	const closedSet = new Set<string>()

	const startNode: AStarNode = {
		x: start.gx,
		y: start.gy,
		g: 0,
		h: heuristic(start.gx, start.gy, end.gx, end.gy),
		f: 0,
		parent: null,
		direction: null,
	}
	startNode.f = startNode.g + startNode.h
	openSet.push(startNode)

	let iterations = 0
	const maxIterations = grid.width * grid.height * 4

	while (openSet.length > 0 && iterations < maxIterations) {
		iterations++

		// Find node with lowest f score
		openSet.sort((a, b) => a.f - b.f)
		const current = openSet.shift()!

		// Check if we reached the goal
		if (current.x === end.gx && current.y === end.gy) {
			// Reconstruct path
			const path: [number, number][] = []
			let node: AStarNode | null = current

			while (node) {
				const worldPos = gridToWorld(grid, node.x, node.y)
				path.unshift([worldPos.x, worldPos.y])
				node = node.parent
			}

			return simplifyPath(path)
		}

		closedSet.add(`${current.x},${current.y}`)

		// Process neighbors
		for (const neighbor of getNeighbors(grid, current)) {
			const key = `${neighbor.x},${neighbor.y}`
			if (closedSet.has(key)) continue

			const cell = grid.cells[neighbor.y]?.[neighbor.x]

			// Calculate base movement cost
			let moveCost = 1

			// Padding cells cost more (discourages paths close to nodes)
			if (cell === "padding") {
				moveCost = 3
			}

			// Arrow cells cost even more (discourages overlapping with existing arrows)
			if (cell === "arrow") {
				moveCost = 8
			}

			// Check arrow usage - heavily penalize cells used by many arrows
			const usageKey = `${neighbor.x},${neighbor.y}`
			const usage = grid.arrowUsage.get(usageKey) ?? 0
			if (usage > 0) {
				moveCost += usage * 50 // Extremely strong penalty for shared cells
			}

			// Add turn penalty to encourage straighter paths
			let turnPenalty = 0
			if (current.direction && neighbor.direction !== current.direction) {
				turnPenalty = 3 // Penalty for turning
			}

			const g = current.g + moveCost + turnPenalty
			const h = heuristic(neighbor.x, neighbor.y, end.gx, end.gy)
			const f = g + h

			// Check if this neighbor is already in open set with better score
			const existingIndex = openSet.findIndex(
				(n) => n.x === neighbor.x && n.y === neighbor.y,
			)
			if (existingIndex !== -1) {
				if (openSet[existingIndex]!.g <= g) continue
				openSet.splice(existingIndex, 1)
			}

			openSet.push({
				x: neighbor.x,
				y: neighbor.y,
				g,
				h,
				f,
				parent: current,
				direction: neighbor.direction,
			})
		}
	}

	// No path found - return null
	return null
}

/**
 * Mark cells along a path as used by an arrow
 * This helps spread subsequent arrows apart
 */
export function markPathAsUsed(grid: Grid, path: [number, number][]): void {
	if (path.length < 2) return

	for (let i = 0; i < path.length - 1; i++) {
		const [x1, y1] = path[i]!
		const [x2, y2] = path[i + 1]!

		// Mark cells along this segment
		const start = worldToGrid(grid, x1, y1)
		const end = worldToGrid(grid, x2, y2)

		const dx = Math.sign(end.gx - start.gx)
		const dy = Math.sign(end.gy - start.gy)

		let cx = start.gx
		let cy = start.gy

		// Limit iterations to prevent infinite loops
		const maxIterations =
			Math.abs(end.gx - start.gx) + Math.abs(end.gy - start.gy) + 10
		let iterations = 0

		while (iterations < maxIterations) {
			iterations++
			const key = `${cx},${cy}`
			grid.arrowUsage.set(key, (grid.arrowUsage.get(key) ?? 0) + 1)

			// Mark adjacent cells more strongly to create wider buffer zones
			// This forces subsequent arrows to route further away
			for (let adjDist = 1; adjDist <= 5; adjDist++) {
				const penalty = 2 / adjDist // Stronger penalty for closer cells
				for (const [adjX, adjY] of [
					[cx - adjDist, cy],
					[cx + adjDist, cy],
					[cx, cy - adjDist],
					[cx, cy + adjDist],
				]) {
					const adjKey = `${adjX},${adjY}`
					grid.arrowUsage.set(
						adjKey,
						(grid.arrowUsage.get(adjKey) ?? 0) + penalty,
					)
				}
			}

			if (cx === end.gx && cy === end.gy) break

			if (dx !== 0) cx += dx
			if (dy !== 0) cy += dy
		}
	}
}

/**
 * Get the edge connection point for a node based on direction
 */
function getEdgePoint(
	pos: NodePosition,
	direction: "top" | "bottom" | "left" | "right",
	offset = 0,
): { x: number; y: number } {
	const centerX = pos.x + pos.width / 2
	const centerY = pos.y + pos.height / 2

	switch (direction) {
		case "top":
			return { x: centerX + offset, y: pos.y }
		case "bottom":
			return { x: centerX + offset, y: pos.y + pos.height }
		case "left":
			return { x: pos.x, y: centerY + offset }
		case "right":
			return { x: pos.x + pos.width, y: centerY + offset }
	}
}

/**
 * Determine best edge to exit/enter based on relative positions
 */
function getBestEdge(
	from: NodePosition,
	to: NodePosition,
	isStart: boolean,
): "top" | "bottom" | "left" | "right" {
	const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
	const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 }

	const dx = toCenter.x - fromCenter.x
	const dy = toCenter.y - fromCenter.y

	const absDx = Math.abs(dx)
	const absDy = Math.abs(dy)

	if (isStart) {
		// For start node, exit toward target
		if (absDx > absDy) {
			return dx > 0 ? "right" : "left"
		}
		return dy > 0 ? "bottom" : "top"
	}
	// For end node, enter from source
	if (absDx > absDy) {
		return dx > 0 ? "left" : "right"
	}
	return dy > 0 ? "top" : "bottom"
}

/**
 * Connection point tracker to spread multiple connections on same edge
 */
export interface ConnectionTracker {
	/** Map of nodeId-edge to number of connections */
	counts: Map<string, number>
	/** Global arrow index for routing channel assignment */
	arrowIndex: number
}

export function createConnectionTracker(): ConnectionTracker {
	return { counts: new Map(), arrowIndex: 0 }
}

/**
 * Get an offset for a connection based on how many already exist
 */
function getConnectionOffset(
	tracker: ConnectionTracker,
	nodeId: string,
	edge: "top" | "bottom" | "left" | "right",
	pos: NodePosition,
): number {
	const key = `${nodeId}-${edge}`
	const count = tracker.counts.get(key) ?? 0
	tracker.counts.set(key, count + 1)

	// Spread connections along the edge with wider spacing
	const spacing = 25 // Wide spacing between connections
	const maxOffset =
		edge === "top" || edge === "bottom" ? pos.width / 2.2 : pos.height / 2.2

	// Alternate sides: 0, -1, 1, -2, 2, ...
	const offset =
		count === 0
			? 0
			: Math.ceil(count / 2) * (count % 2 === 0 ? -1 : 1) * spacing
	return Math.max(-maxOffset, Math.min(maxOffset, offset))
}

/**
 * Find orthogonal path between two nodes using A* with obstacle avoidance
 * Returns: { startPoint, endPoint, path } where path is relative to startPoint
 */
export function findOrthogonalPath(
	grid: Grid,
	fromPos: NodePosition,
	toPos: NodePosition,
	tracker?: ConnectionTracker,
): {
	startPoint: { x: number; y: number }
	endPoint: { x: number; y: number }
	path: [number, number][]
} {
	const startEdge = getBestEdge(fromPos, toPos, true)
	const endEdge = getBestEdge(fromPos, toPos, false)

	// Get offsets for spreading multiple connections on same edge
	const startOffset = tracker
		? getConnectionOffset(tracker, fromPos.id, startEdge, fromPos)
		: 0
	const endOffset = tracker
		? getConnectionOffset(tracker, toPos.id, endEdge, toPos)
		: 0

	const startPoint = getEdgePoint(fromPos, startEdge, startOffset)
	const endPoint = getEdgePoint(toPos, endEdge, endOffset)

	// Increment arrow index for tracking
	if (tracker) tracker.arrowIndex++

	// Try A* pathfinding
	const gridPath = findPath(
		grid,
		startPoint.x,
		startPoint.y,
		endPoint.x,
		endPoint.y,
	)

	if (gridPath && gridPath.length > 1) {
		// Mark this path as used for subsequent arrows
		markPathAsUsed(grid, gridPath)

		// Convert to relative path
		const path: [number, number][] = []
		for (const [px, py] of gridPath) {
			path.push([px - startPoint.x, py - startPoint.y])
		}

		return { startPoint, endPoint, path }
	}

	// Fallback: create a safe L-shaped path that routes around the edges
	const dx = endPoint.x - startPoint.x
	const dy = endPoint.y - startPoint.y
	const path: [number, number][] = [[0, 0]]

	// Route outside the diagram bounds to avoid all obstacles
	const boundsOffset = 100

	if (startEdge === "left") {
		path.push([-boundsOffset, 0])
		path.push([-boundsOffset, dy])
		path.push([dx, dy])
	} else if (startEdge === "right") {
		path.push([boundsOffset, 0])
		path.push([boundsOffset, dy])
		path.push([dx, dy])
	} else if (startEdge === "top") {
		path.push([0, -boundsOffset])
		path.push([dx, -boundsOffset])
		path.push([dx, dy])
	} else {
		path.push([0, boundsOffset])
		path.push([dx, boundsOffset])
		path.push([dx, dy])
	}

	// Mark fallback path
	const absolutePath: [number, number][] = path.map(([px, py]) => [
		startPoint.x + px,
		startPoint.y + py,
	])
	markPathAsUsed(grid, absolutePath)

	return { startPoint, endPoint, path }
}
