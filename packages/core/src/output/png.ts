/**
 * PNG rendering for Excalidraw diagrams using Puppeteer
 *
 * Uses Excalidraw's native exportToBlob API for accurate rendering
 * including proper arrow bindings, shape styles, and all visual features.
 */

import type { ExcalidrawFile } from "../excalidraw/types"

export interface BrowserCheckResult {
	available: boolean
	error?: string
	browserPath?: string
}

/**
 * Check if Puppeteer can launch a browser for PNG rendering.
 * Returns availability status and helpful error messages if not available.
 */
export async function checkBrowserAvailability(): Promise<BrowserCheckResult> {
	try {
		const puppeteer = await import("puppeteer")
		const browser = await puppeteer.default.launch({
			headless: true,
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		})
		const executablePath = browser.process()?.spawnfile
		await browser.close()
		return {
			available: true,
			browserPath: executablePath,
		}
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err)

		// Provide helpful error messages based on common issues
		if (error.includes("Could not find Chromium") || error.includes("ENOENT")) {
			return {
				available: false,
				error: `Chromium not found. Puppeteer should auto-download it on first run.

If download failed, try:
  1. Run: npx puppeteer browsers install chrome
  2. Or set PUPPETEER_EXECUTABLE_PATH to your Chrome/Chromium installation

On macOS: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
On Linux: /usr/bin/chromium-browser or /usr/bin/google-chrome`,
			}
		}

		if (error.includes("EACCES") || error.includes("permission")) {
			return {
				available: false,
				error: `Permission error launching browser.

Try running with appropriate permissions or set PUPPETEER_EXECUTABLE_PATH
to a browser you have access to.`,
			}
		}

		return {
			available: false,
			error: `Failed to launch browser: ${error}`,
		}
	}
}

export interface PngRenderOptions {
	width?: number
	height?: number
	backgroundColor?: string
	scale?: number
	padding?: number
}

const DEFAULT_OPTIONS: Required<PngRenderOptions> = {
	width: 1920,
	height: 1080,
	backgroundColor: "#ffffff",
	scale: 2,
	padding: 50,
}

/**
 * Render Excalidraw JSON to PNG buffer using Excalidraw's native export
 */
export async function renderExcalidrawToPng(
	excalidraw: ExcalidrawFile,
	options?: PngRenderOptions,
): Promise<Buffer> {
	const opts = { ...DEFAULT_OPTIONS, ...options }

	// Dynamic import puppeteer
	const puppeteer = await import("puppeteer")
	const browser = await puppeteer.default.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	})

	try {
		const page = await browser.newPage()

		// Set a large viewport to accommodate the diagram
		await page.setViewport({
			width: 1920,
			height: 1080,
			deviceScaleFactor: opts.scale,
		})

		// Create HTML page that loads Excalidraw and exports to PNG
		const html = createExcalidrawExportHtml(excalidraw, opts)
		await page.setContent(html, { waitUntil: "networkidle2", timeout: 60000 })

		// Wait for Excalidraw module to be loaded
		await page.waitForFunction(
			() =>
				(window as unknown as { __EXCALIDRAW_LOADED__: boolean })
					.__EXCALIDRAW_LOADED__,
			{ timeout: 60000 },
		)

		// Trigger export
		await page.evaluate(() => {
			;(window as unknown as { exportToPng: () => void }).exportToPng()
		})

		// Wait for export to complete
		await page.waitForFunction(
			() =>
				(window as unknown as { __EXPORT_COMPLETE__: boolean })
					.__EXPORT_COMPLETE__,
			{ timeout: 60000 },
		)

		// Get the exported PNG data and any errors
		const result = await page.evaluate(() => {
			return {
				data: (window as unknown as { __EXPORT_DATA__: string })
					.__EXPORT_DATA__,
				error: (window as unknown as { __EXPORT_ERROR__: string })
					.__EXPORT_ERROR__,
			}
		})

		if (!result.data) {
			const errorMsg = result.error || "Unknown error"
			throw new Error(`Failed to export PNG from Excalidraw: ${errorMsg}`)
		}

		return Buffer.from(result.data, "base64")
	} finally {
		await browser.close()
	}
}

/**
 * Create HTML page that uses Excalidraw's exportToBlob
 */
function createExcalidrawExportHtml(
	excalidraw: ExcalidrawFile,
	options: Required<PngRenderOptions>,
): string {
	const data = JSON.stringify(excalidraw)

	return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
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
  <style>
    * { margin: 0; padding: 0; }
    body { background: ${options.backgroundColor}; }
    #root { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>

  <script type="module">
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { Excalidraw, exportToBlob } from 'https://esm.sh/@excalidraw/excalidraw@0.18.0?external=react,react-dom';

    window.__EXPORT_COMPLETE__ = false;
    window.__EXPORT_DATA__ = null;
    window.__EXPORT_ERROR__ = null;
    window.__EXCALIDRAW_LOADED__ = false;

    const data = ${data};

    // Reference to the Excalidraw API
    let excalidrawAPI = null;

    // Create the Excalidraw component
    const App = () => {
      return React.createElement(Excalidraw, {
        excalidrawAPI: (api) => {
          excalidrawAPI = api;
          window.__EXCALIDRAW_LOADED__ = true;
        },
        initialData: {
          elements: data.elements || [],
          appState: {
            viewBackgroundColor: "${options.backgroundColor}",
          },
          files: data.files || {},
        },
        UIOptions: {
          canvasActions: {
            export: false,
            loadScene: false,
            saveToActiveFile: false,
          },
        },
      });
    };

    // Render the app
    const root = createRoot(document.getElementById('root'));
    root.render(React.createElement(App));

    window.exportToPng = async function() {
      try {
        if (!excalidrawAPI) {
          window.__EXPORT_ERROR__ = 'Excalidraw API not ready';
          window.__EXPORT_COMPLETE__ = true;
          return;
        }

        // Get the processed elements from Excalidraw (with elbow routing applied)
        const elements = excalidrawAPI.getSceneElements();
        const appState = excalidrawAPI.getAppState();
        const files = excalidrawAPI.getFiles();

        const blob = await exportToBlob({
          elements,
          appState: {
            ...appState,
            exportBackground: true,
            viewBackgroundColor: "${options.backgroundColor}",
          },
          files,
        });

        const reader = new FileReader();
        reader.onloadend = () => {
          window.__EXPORT_DATA__ = reader.result.split(',')[1];
          window.__EXPORT_COMPLETE__ = true;
        };
        reader.onerror = (err) => {
          window.__EXPORT_ERROR__ = 'FileReader error: ' + err;
          window.__EXPORT_COMPLETE__ = true;
        };
        reader.readAsDataURL(blob);
      } catch (error) {
        window.__EXPORT_ERROR__ = 'Export failed: ' + error.message;
        window.__EXPORT_COMPLETE__ = true;
      }
    };
  </script>
</body>
</html>`
}

/**
 * Render Excalidraw JSON to PNG file
 */
export async function renderExcalidrawToFile(
	excalidraw: ExcalidrawFile,
	outputPath: string,
	options?: PngRenderOptions,
): Promise<void> {
	const buffer = await renderExcalidrawToPng(excalidraw, options)
	const { writeFile } = await import("node:fs/promises")
	await writeFile(outputPath, buffer)
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
