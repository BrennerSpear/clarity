# Excalidraw Rendering & Pathfinding Summary

## Excalidraw PNG Export

### Key Discovery: Component Mounting Required

Excalidraw's `exportToBlob` function alone does **not** apply elbow arrow routing. The elbow routing algorithm runs when elements are loaded into the Excalidraw React component.

**What doesn't work:**
```javascript
// Direct export - elbow routing NOT applied
const blob = await exportToBlob({
  elements: data.elements,
  appState: { ... },
});
```

**What works:**
```javascript
// Mount component, let it process elements, then export
const App = () => React.createElement(Excalidraw, {
  excalidrawAPI: (api) => { excalidrawAPI = api; },
  initialData: { elements, appState, files },
});

// After mounting, get processed elements
const processedElements = excalidrawAPI.getSceneElements();
const blob = await exportToBlob({ elements: processedElements, ... });
```

### ESM Loading via esm.sh

Excalidraw is ESM-only (no UMD bundle). We use esm.sh with import maps to load it in Puppeteer:

```html
<script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@18.2.0",
    "react/jsx-runtime": "https://esm.sh/react@18.2.0/jsx-runtime",
    "react/jsx-dev-runtime": "https://esm.sh/react@18.2.0/jsx-dev-runtime",
    "react-dom": "https://esm.sh/react-dom@18.2.0",
    "react-dom/client": "https://esm.sh/react-dom@18.2.0/client"
  }
}
</script>
<script type="module">
  import { Excalidraw, exportToBlob } from 'https://esm.sh/@excalidraw/excalidraw@0.18.0?external=react,react-dom';
</script>
```

The `?external=react,react-dom` parameter tells esm.sh to use the import map's React instead of bundling its own (prevents React instance mismatch errors).

### Arrow Properties for Elbow Routing

```typescript
{
  type: "arrow",
  elbowed: true,           // REQUIRED for 90-degree routing
  roundness: null,         // Sharp corners (Excalidraw still applies slight elbow rounding)
  roughness: 0,            // Clean lines (1 = hand-drawn style)
  points: [[0, 0], [dx, dy]],  // Just start/end - Excalidraw calculates the route
  startBinding: { elementId, focus: 0, gap: 1 },
  endBinding: { elementId, focus: 0, gap: 1 },
}
```

### Text Centering in Shapes

Text bound to a container shape needs:
- `containerId: shapeId` on the text element
- `boundElements: [{ id: textId, type: "text" }]` on the shape
- Text x/y positioned at center of container (Excalidraw adjusts based on `textAlign`/`verticalAlign`)

```typescript
// Calculate text position for centering
const textWidth = Math.min(text.length * fontSize * 0.6, containerWidth - 20);
const x = containerX + (containerWidth - textWidth) / 2;
const y = containerY + (containerHeight - textHeight) / 2;
```

---

## Current Pathfinding Implementation

### Location
`packages/core/src/excalidraw/pathfinding.ts`

### Algorithm: A* with Orthogonal Movement

The pathfinder creates a grid from node positions and finds paths that avoid obstacles.

#### Grid Creation (`createGrid`)
```typescript
function createGrid(positions: Map<string, NodePosition>, cellSize = 20, padding = 40): Grid
```

- Calculates bounds from all node positions
- Creates 2D array of cells: `"empty" | "obstacle" | "padding"`
- Marks node areas as `"obstacle"`
- Marks 1-cell buffer around nodes as `"padding"` (traversable but higher cost)

#### A* Implementation (`findPath`)

**Movement:** Orthogonal only (up, down, left, right)

**Cost function:**
- Empty cell: cost 1
- Padding cell: cost 2 (discourages paths close to nodes)
- Turn penalty: +5 (encourages straighter paths)

**Heuristic:** Manhattan distance

**Path simplification:** Removes collinear intermediate points (keeps only corners)

#### Edge Connection Points (`findOrthogonalPath`)

Determines where arrows exit/enter shapes based on relative position:
- If target is mainly to the right → exit from right edge
- If target is mainly below → exit from bottom edge
- etc.

### Current Limitations

1. **No arrow spreading:** Multiple arrows between same areas overlap completely
2. **No consideration of other arrows:** Each path calculated independently
3. **Simple edge selection:** Always uses center of edge, not optimal connection point
4. **Grid resolution:** Fixed 20px cells may be too coarse for dense diagrams

### Unused Code

When `elbowed: true` is set, Excalidraw handles all routing. Our pathfinding is currently **not used** for the final render - Excalidraw's internal elbow router takes over.

Our pathfinding could still be useful for:
- Pre-calculating rough routes to influence Excalidraw's routing
- Determining optimal connection points on shapes
- Spreading arrows to avoid overlap (if we can influence Excalidraw's routing)

---

## File Locations

| File | Purpose |
|------|---------|
| `packages/core/src/output/png.ts` | PNG export via Puppeteer + Excalidraw component |
| `packages/core/src/excalidraw/render.ts` | Creates Excalidraw JSON from graph |
| `packages/core/src/excalidraw/pathfinding.ts` | A* pathfinding (currently unused with elbow arrows) |
| `packages/core/src/excalidraw/types.ts` | Excalidraw element type definitions |
| `packages/core/src/excalidraw/semantic-layout.ts` | Left-to-right layout by service role |

---

## Next Steps for Pathfinding Improvement

1. **Arrow spreading:** Offset parallel arrows so they don't overlap
2. **Connection point optimization:** Choose which edge of a shape to connect to based on other connections
3. **Investigate Excalidraw's routing:** Can we influence where elbow arrows route? (fixedSegments property?)
4. **Consider disabling elbowed mode:** Use our own pathfinding with multi-point paths if we need more control
