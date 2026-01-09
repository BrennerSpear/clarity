/**
 * A* pathfinding for orthogonal arrow routing
 *
 * Creates a grid, marks obstacles (nodes), and finds paths around them
 */

import type { NodePosition } from "./layout"

/**
 * Grid cell state
 */
type CellState = "empty" | "obstacle" | "padding"

/**
 * Grid for pathfinding
 */
interface Grid {
	cells: CellState[][]
	width: number
	height: number
	cellSize: number
	offsetX: number
	offsetY: number
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
}

/**
 * Create a grid from node positions
 */
export function createGrid(
	positions: Map<string, NodePosition>,
	cellSize = 20,
	padding = 40,
): Grid {
	if (positions.size === 0) {
		return { cells: [[]], width: 1, height: 1, cellSize, offsetX: 0, offsetY: 0 }
	}

	// Find bounds
	let minX = Infinity, minY = Infinity
	let maxX = -Infinity, maxY = -Infinity

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
		const startX = Math.floor((pos.x - minX) / cellSize)
		const startY = Math.floor((pos.y - minY) / cellSize)
		const endX = Math.ceil((pos.x + pos.width - minX) / cellSize)
		const endY = Math.ceil((pos.y + pos.height - minY) / cellSize)

		// Mark the node itself as obstacle
		for (let y = startY; y <= endY; y++) {
			for (let x = startX; x <= endX; x++) {
				if (y >= 0 && y < height && x >= 0 && x < width) {
					cells[y]![x] = "obstacle"
				}
			}
		}

		// Mark padding around the node (1 cell buffer)
		for (let y = startY - 1; y <= endY + 1; y++) {
			for (let x = startX - 1; x <= endX + 1; x++) {
				if (y >= 0 && y < height && x >= 0 && x < width) {
					if (cells[y]![x] === "empty") {
						cells[y]![x] = "padding"
					}
				}
			}
		}
	}

	return { cells, width, height, cellSize, offsetX: minX, offsetY: minY }
}

/**
 * Convert world coordinates to grid coordinates
 */
function worldToGrid(grid: Grid, x: number, y: number): { gx: number; gy: number } {
	return {
		gx: Math.round((x - grid.offsetX) / grid.cellSize),
		gy: Math.round((y - grid.offsetY) / grid.cellSize),
	}
}

/**
 * Convert grid coordinates to world coordinates
 */
function gridToWorld(grid: Grid, gx: number, gy: number): { x: number; y: number } {
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
 * Get neighbors (orthogonal only - up, down, left, right)
 */
function getNeighbors(grid: Grid, node: AStarNode): { x: number; y: number }[] {
	const neighbors: { x: number; y: number }[] = []
	const dirs = [
		{ dx: 0, dy: -1 }, // up
		{ dx: 0, dy: 1 },  // down
		{ dx: -1, dy: 0 }, // left
		{ dx: 1, dy: 0 },  // right
	]

	for (const { dx, dy } of dirs) {
		const nx = node.x + dx
		const ny = node.y + dy

		if (nx >= 0 && nx < grid.width && ny >= 0 && ny < grid.height) {
			const cell = grid.cells[ny]?.[nx]
			// Allow empty cells and padding (padding is traversable but less preferred)
			if (cell === "empty" || cell === "padding") {
				neighbors.push({ x: nx, y: ny })
			}
		}
	}

	return neighbors
}

/**
 * Check if two points are on the same line (for path simplification)
 */
function isCollinear(p1: [number, number], p2: [number, number], p3: [number, number]): boolean {
	return (p1[0] === p2[0] && p2[0] === p3[0]) || (p1[1] === p2[1] && p2[1] === p3[1])
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
 * Find nearest empty cell to a position
 */
function findNearestEmpty(grid: Grid, gx: number, gy: number): { gx: number; gy: number } {
	// Check if already empty or padding (traversable)
	if (gx >= 0 && gx < grid.width && gy >= 0 && gy < grid.height) {
		const cell = grid.cells[gy]?.[gx]
		if (cell === "empty" || cell === "padding") {
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
					if (cell === "empty" || cell === "padding") {
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
	}
	startNode.f = startNode.g + startNode.h
	openSet.push(startNode)

	let iterations = 0
	const maxIterations = grid.width * grid.height * 2

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

			// Calculate cost (padding cells cost more to discourage paths close to nodes)
			const cell = grid.cells[neighbor.y]?.[neighbor.x]
			const moveCost = cell === "padding" ? 2 : 1

			// Add turn penalty to encourage straighter paths
			let turnPenalty = 0
			if (current.parent) {
				const prevDx = current.x - current.parent.x
				const prevDy = current.y - current.parent.y
				const newDx = neighbor.x - current.x
				const newDy = neighbor.y - current.y
				if (prevDx !== newDx || prevDy !== newDy) {
					turnPenalty = 5 // Penalty for turning
				}
			}

			const g = current.g + moveCost + turnPenalty
			const h = heuristic(neighbor.x, neighbor.y, end.gx, end.gy)
			const f = g + h

			// Check if this neighbor is already in open set with better score
			const existingIndex = openSet.findIndex(n => n.x === neighbor.x && n.y === neighbor.y)
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
			})
		}
	}

	// No path found - return straight line as fallback
	return null
}

/**
 * Get the edge connection point for a node based on direction
 */
function getEdgePoint(
	pos: NodePosition,
	isHorizontal: boolean,
	isPositive: boolean,
	isStart: boolean,
): { x: number; y: number } {
	const centerX = pos.x + pos.width / 2
	const centerY = pos.y + pos.height / 2

	if (isHorizontal) {
		// Start exits toward target, end enters from source
		const exitRight = isStart ? isPositive : !isPositive
		return {
			x: exitRight ? pos.x + pos.width : pos.x,
			y: centerY,
		}
	}
	// Vertical
	const exitBottom = isStart ? isPositive : !isPositive
	return {
		x: centerX,
		y: exitBottom ? pos.y + pos.height : pos.y,
	}
}

/**
 * Find orthogonal path between two nodes
 * Returns: { startPoint, endPoint, path } where path is relative to startPoint
 */
export function findOrthogonalPath(
	grid: Grid,
	fromPos: NodePosition,
	toPos: NodePosition,
): { startPoint: { x: number; y: number }; endPoint: { x: number; y: number }; path: [number, number][] } {
	const fromCenter = { x: fromPos.x + fromPos.width / 2, y: fromPos.y + fromPos.height / 2 }
	const toCenter = { x: toPos.x + toPos.width / 2, y: toPos.y + toPos.height / 2 }

	const dx = toCenter.x - fromCenter.x
	const dy = toCenter.y - fromCenter.y
	const isHorizontal = Math.abs(dx) > Math.abs(dy)

	const startPoint = getEdgePoint(fromPos, isHorizontal, isHorizontal ? dx > 0 : dy > 0, true)
	const endPoint = getEdgePoint(toPos, isHorizontal, isHorizontal ? dx > 0 : dy > 0, false)

	// Find path through the grid
	const gridPath = findPath(grid, startPoint.x, startPoint.y, endPoint.x, endPoint.y)

	if (gridPath && gridPath.length > 1) {
		// Build path that starts exactly at startPoint and ends exactly at endPoint
		const path: [number, number][] = [[0, 0]]

		// Add intermediate points from grid path (skip first and last which may not be exact)
		for (let i = 1; i < gridPath.length - 1; i++) {
			const [px, py] = gridPath[i]!
			path.push([px - startPoint.x, py - startPoint.y])
		}

		// End exactly at the target edge
		path.push([endPoint.x - startPoint.x, endPoint.y - startPoint.y])

		return { startPoint, endPoint, path }
	}

	// Fallback: simple orthogonal path (L-shape or straight)
	const path: [number, number][] = [[0, 0]]

	if (Math.abs(dx) > 10 && Math.abs(dy) > 10) {
		// L-shape: go horizontal first, then vertical
		const midX = endPoint.x - startPoint.x
		path.push([midX, 0])
		path.push([midX, endPoint.y - startPoint.y])
	} else {
		// Straight line
		path.push([endPoint.x - startPoint.x, endPoint.y - startPoint.y])
	}

	return { startPoint, endPoint, path }
}
