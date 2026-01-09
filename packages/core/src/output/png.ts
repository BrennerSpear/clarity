/**
 * PNG rendering for Excalidraw diagrams using Puppeteer
 *
 * Uses a custom canvas-based renderer that draws shapes directly,
 * avoiding the complexity of loading the full Excalidraw React app.
 */

import type { ExcalidrawFile } from "../excalidraw/types"

export interface RenderOptions {
	width?: number
	height?: number
	backgroundColor?: string
	scale?: number
	padding?: number
}

const DEFAULT_OPTIONS: Required<RenderOptions> = {
	width: 1920,
	height: 1080,
	backgroundColor: "#ffffff",
	scale: 2,
	padding: 50,
}

/**
 * Render Excalidraw JSON to PNG buffer using canvas
 */
export async function renderExcalidrawToPng(
	excalidraw: ExcalidrawFile,
	options?: RenderOptions,
): Promise<Buffer> {
	const opts = { ...DEFAULT_OPTIONS, ...options }

	// Calculate bounds to auto-fit content
	const bounds = calculateBoundingBox(excalidraw)
	const contentWidth = bounds.width + opts.padding * 2
	const contentHeight = bounds.height + opts.padding * 2

	// Use content size or default, whichever is larger
	const finalWidth = Math.max(opts.width, contentWidth)
	const finalHeight = Math.max(opts.height, contentHeight)

	// Dynamic import puppeteer to avoid issues if not installed
	const puppeteer = await import("puppeteer")
	const browser = await puppeteer.default.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	})

	try {
		const page = await browser.newPage()
		await page.setViewport({
			width: Math.ceil(finalWidth),
			height: Math.ceil(finalHeight),
			deviceScaleFactor: opts.scale,
		})

		// Create HTML page with simple canvas rendering
		const html = createCanvasHtml(excalidraw, {
			...opts,
			width: finalWidth,
			height: finalHeight,
		}, bounds)
		await page.setContent(html, { waitUntil: "load" })

		// Wait for canvas to render
		await page.waitForFunction(
			() => (window as unknown as { __RENDERED__: boolean }).__RENDERED__,
			{ timeout: 10000 },
		)

		// Take screenshot of the canvas
		const pngBuffer = await page.screenshot({
			type: "png",
			fullPage: false,
			clip: {
				x: 0,
				y: 0,
				width: Math.ceil(finalWidth),
				height: Math.ceil(finalHeight),
			},
		})

		return Buffer.from(pngBuffer)
	} finally {
		await browser.close()
	}
}

/**
 * Render Excalidraw JSON to PNG file
 */
export async function renderExcalidrawToFile(
	excalidraw: ExcalidrawFile,
	outputPath: string,
	options?: RenderOptions,
): Promise<void> {
	const buffer = await renderExcalidrawToPng(excalidraw, options)
	const { writeFile } = await import("node:fs/promises")
	await writeFile(outputPath, buffer)
}

/**
 * Create HTML page with canvas-based rendering
 */
function createCanvasHtml(
	excalidraw: ExcalidrawFile,
	options: Required<RenderOptions>,
	bounds: ReturnType<typeof calculateBoundingBox>,
): string {
	const elements = JSON.stringify(excalidraw.elements)
	const offsetX = -bounds.minX + options.padding
	const offsetY = -bounds.minY + options.padding

	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: ${options.backgroundColor};
      font-family: 'Segoe UI', system-ui, sans-serif;
    }
    canvas { display: block; }
  </style>
</head>
<body>
  <canvas id="canvas" width="${options.width}" height="${options.height}"></canvas>
  <script>
    window.__RENDERED__ = false;

    const elements = ${elements};
    const offsetX = ${offsetX};
    const offsetY = ${offsetY};

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    // Fill background
    ctx.fillStyle = '${options.backgroundColor}';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Sort elements: shapes first, then arrows, then text
    const sortedElements = [...elements].sort((a, b) => {
      const order = { rectangle: 0, ellipse: 0, diamond: 0, arrow: 1, line: 1, text: 2 };
      return (order[a.type] ?? 0) - (order[b.type] ?? 0);
    });

    // Draw each element
    for (const el of sortedElements) {
      if (el.isDeleted) continue;

      const x = el.x + offsetX;
      const y = el.y + offsetY;

      ctx.save();
      ctx.globalAlpha = (el.opacity ?? 100) / 100;

      if (el.type === 'rectangle') {
        drawRectangle(ctx, x, y, el.width, el.height, el);
      } else if (el.type === 'ellipse') {
        drawEllipse(ctx, x, y, el.width, el.height, el);
      } else if (el.type === 'diamond') {
        drawDiamond(ctx, x, y, el.width, el.height, el);
      } else if (el.type === 'arrow' || el.type === 'line') {
        drawArrow(ctx, x, y, el);
      } else if (el.type === 'text') {
        drawText(ctx, x, y, el);
      }

      ctx.restore();
    }

    function drawRectangle(ctx, x, y, w, h, el) {
      ctx.beginPath();
      const r = el.roundness ? Math.min(w, h) * 0.1 : 0;
      if (r > 0) {
        ctx.roundRect(x, y, w, h, r);
      } else {
        ctx.rect(x, y, w, h);
      }

      if (el.backgroundColor && el.backgroundColor !== 'transparent') {
        ctx.fillStyle = el.backgroundColor;
        ctx.fill();
      }

      ctx.strokeStyle = el.strokeColor || '#1e1e1e';
      ctx.lineWidth = el.strokeWidth || 2;
      ctx.stroke();
    }

    function drawEllipse(ctx, x, y, w, h, el) {
      ctx.beginPath();
      ctx.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI * 2);

      if (el.backgroundColor && el.backgroundColor !== 'transparent') {
        ctx.fillStyle = el.backgroundColor;
        ctx.fill();
      }

      ctx.strokeStyle = el.strokeColor || '#1e1e1e';
      ctx.lineWidth = el.strokeWidth || 2;
      ctx.stroke();
    }

    function drawDiamond(ctx, x, y, w, h, el) {
      ctx.beginPath();
      ctx.moveTo(x + w/2, y);
      ctx.lineTo(x + w, y + h/2);
      ctx.lineTo(x + w/2, y + h);
      ctx.lineTo(x, y + h/2);
      ctx.closePath();

      if (el.backgroundColor && el.backgroundColor !== 'transparent') {
        ctx.fillStyle = el.backgroundColor;
        ctx.fill();
      }

      ctx.strokeStyle = el.strokeColor || '#1e1e1e';
      ctx.lineWidth = el.strokeWidth || 2;
      ctx.stroke();
    }

    function drawArrow(ctx, x, y, el) {
      if (!el.points || el.points.length < 2) return;

      ctx.strokeStyle = el.strokeColor || '#868e96';
      ctx.lineWidth = el.strokeWidth || 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Draw the path (works for both straight and orthogonal arrows)
      ctx.beginPath();
      ctx.moveTo(x + el.points[0][0], y + el.points[0][1]);

      for (let i = 1; i < el.points.length; i++) {
        ctx.lineTo(x + el.points[i][0], y + el.points[i][1]);
      }
      ctx.stroke();

      // Draw arrowhead at the end
      if (el.endArrowhead === 'arrow' && el.points.length >= 2) {
        const lastPoint = el.points[el.points.length - 1];
        const prevPoint = el.points[el.points.length - 2];

        // Calculate angle from the last segment
        const angle = Math.atan2(
          lastPoint[1] - prevPoint[1],
          lastPoint[0] - prevPoint[0]
        );

        const arrowSize = 10;
        const endX = x + lastPoint[0];
        const endY = y + lastPoint[1];

        // Draw filled arrowhead for better visibility
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(
          endX - arrowSize * Math.cos(angle - Math.PI / 6),
          endY - arrowSize * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          endX - arrowSize * Math.cos(angle + Math.PI / 6),
          endY - arrowSize * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fillStyle = el.strokeColor || '#868e96';
        ctx.fill();
      }
    }

    function drawText(ctx, x, y, el) {
      const fontSize = el.fontSize || 16;
      const fontFamily = el.fontFamily === 1 ? 'Segoe UI, system-ui, sans-serif' :
                         el.fontFamily === 2 ? 'Georgia, serif' :
                         'monospace';

      ctx.font = fontSize + 'px ' + fontFamily;
      ctx.fillStyle = el.strokeColor || '#1e1e1e';

      const lines = (el.text || '').split('\\n');
      const lineHeight = fontSize * (el.lineHeight || 1.25);
      const totalTextHeight = lines.length * lineHeight;

      // If text is inside a container, find it and center properly
      let container = null;
      if (el.containerId) {
        container = elements.find(e => e.id === el.containerId);
      }

      let textX = x;
      let textY = y;

      if (container) {
        // Center text within container
        const containerX = container.x + offsetX;
        const containerY = container.y + offsetY;
        const containerW = container.width;
        const containerH = container.height;

        // Horizontal centering
        ctx.textAlign = 'center';
        textX = containerX + containerW / 2;

        // Vertical centering
        ctx.textBaseline = 'middle';
        textY = containerY + containerH / 2 - (totalTextHeight - lineHeight) / 2;
      } else {
        // Non-contained text
        ctx.textAlign = el.textAlign || 'left';
        ctx.textBaseline = 'top';

        if (el.textAlign === 'center') {
          textX = x + el.width / 2;
        } else if (el.textAlign === 'right') {
          textX = x + el.width;
        }

        if (el.verticalAlign === 'middle') {
          textY = y + (el.height - totalTextHeight) / 2;
        }
      }

      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], textX, textY + i * lineHeight);
      }
    }

    window.__RENDERED__ = true;
  </script>
</body>
</html>`
}

/**
 * Calculate bounding box of all elements
 */
export function calculateBoundingBox(excalidraw: ExcalidrawFile): {
	minX: number
	minY: number
	maxX: number
	maxY: number
	width: number
	height: number
} {
	if (excalidraw.elements.length === 0) {
		return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
	}

	let minX = Number.POSITIVE_INFINITY
	let minY = Number.POSITIVE_INFINITY
	let maxX = Number.NEGATIVE_INFINITY
	let maxY = Number.NEGATIVE_INFINITY

	for (const el of excalidraw.elements) {
		if (el.isDeleted) continue

		minX = Math.min(minX, el.x)
		minY = Math.min(minY, el.y)
		maxX = Math.max(maxX, el.x + el.width)
		maxY = Math.max(maxY, el.y + el.height)
	}

	return {
		minX,
		minY,
		maxX,
		maxY,
		width: maxX - minX,
		height: maxY - minY,
	}
}

/**
 * Render with auto-fit to content
 */
export async function renderExcalidrawAutoFit(
	excalidraw: ExcalidrawFile,
	outputPath: string,
	padding = 50,
): Promise<void> {
	const bounds = calculateBoundingBox(excalidraw)

	// Add padding
	const width = Math.max(800, bounds.width + padding * 2)
	const height = Math.max(600, bounds.height + padding * 2)

	// Translate elements to fit in view
	const translatedElements = excalidraw.elements.map((el) => ({
		...el,
		x: el.x - bounds.minX + padding,
		y: el.y - bounds.minY + padding,
	}))

	const translatedFile: ExcalidrawFile = {
		...excalidraw,
		elements: translatedElements,
	}

	await renderExcalidrawToFile(translatedFile, outputPath, {
		width: Math.ceil(width),
		height: Math.ceil(height),
	})
}
