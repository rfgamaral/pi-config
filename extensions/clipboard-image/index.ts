import type {
    ExtensionAPI,
    ExtensionContext,
    InputEvent,
    InputEventResult,
} from '@earendil-works/pi-coding-agent'
import { spawnSync } from 'node:child_process'
import {
    findMarkerIndices,
    formatImageMarker,
    installClipboardImageMarkerPatch,
} from './editor-markers'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Maximum image dimension in pixels; larger images are resized proportionally. */
const MAX_DIMENSION = 2000

/** MIME types recognized as images when reading the clipboard. */
const SUPPORTED_MIME_TYPES = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/x-bmp',
    'image/x-ms-bmp',
]

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Image payload queued for attachment on the next message send. */
type ImagePayload = {
    type: 'image'
    data: string
    mimeType: string
}

/** In-memory clipboard-image extension state. */
type ClipboardImageState = {
    pending: Map<number, ImagePayload>
    nextIndex: number
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Select the best image MIME type from the clipboard's advertised types. */
function selectMimeType(types: string[]): string | null {
    for (const supported of SUPPORTED_MIME_TYPES) {
        if (types.includes(supported)) return supported
    }

    return types.find((type) => type.startsWith('image/')) ?? null
}

/**
 * Read an image from the Wayland clipboard, convert it to PNG, and resize
 * to fit within MAX_DIMENSION. Returns base64-encoded PNG data or null.
 */
function readClipboardImage(): ImagePayload | null {
    const listResult = spawnSync('wl-paste', ['--list-types'], {
        timeout: 3000,
        encoding: 'utf8',
    })

    if (listResult.status !== 0 || listResult.error) return null

    const types = listResult.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)

    const mimeType = selectMimeType(types)

    if (!mimeType) return null

    const command =
        `wl-paste --type '${mimeType}'` +
        ` | convert - -resize '${MAX_DIMENSION}x${MAX_DIMENSION}>' -strip png:-`

    const result = spawnSync('bash', ['-c', command], {
        timeout: 10_000,
        maxBuffer: 50 * 1024 * 1024,
    })

    if (result.status !== 0 || result.error) return null

    const stdout = result.stdout

    if (!stdout || (Buffer.isBuffer(stdout) && stdout.length === 0)) return null

    const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)

    return { type: 'image', data: buffer.toString('base64'), mimeType: 'image/png' }
}

// -----------------------------------------------------------------------------
// Main functions
// -----------------------------------------------------------------------------

/** Read a clipboard image and queue it for attachment. */
function pasteImage(ctx: ExtensionContext, state: ClipboardImageState): void {
    const image = readClipboardImage()

    if (!image) {
        ctx.ui.notify('No image found in clipboard.', 'warning')
        return
    }

    const index = state.nextIndex++

    state.pending.set(index, image)

    const marker = formatImageMarker(index)
    const current = ctx.ui.getEditorText()
    const separator = current && !current.endsWith(' ') && !current.endsWith('\n') ? ' ' : ''

    ctx.ui.setEditorText(`${current}${separator}${marker} `)
}

/** Attach pending clipboard images referenced by markers in the outgoing input. */
function transformInput(event: InputEvent, state: ClipboardImageState): InputEventResult {
    if (event.source === 'extension' || state.pending.size === 0) {
        return { action: 'continue' }
    }

    const present = findMarkerIndices(event.text)

    if (present.size === 0) {
        state.pending.clear()
        state.nextIndex = 1
        return { action: 'continue' }
    }

    const attached: ImagePayload[] = []

    for (const index of present) {
        const image = state.pending.get(index)

        if (image) {
            attached.push(image)
        }
    }

    state.pending.clear()
    state.nextIndex = 1

    return {
        action: 'transform',
        text: event.text,
        images: [...(event.images ?? []), ...attached],
    }
}

// -----------------------------------------------------------------------------
// Extension entry point
// -----------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
    const state: ClipboardImageState = {
        pending: new Map<number, ImagePayload>(),
        nextIndex: 1,
    }

    installClipboardImageMarkerPatch(() => new Set(state.pending.keys()))

    pi.on('input', async (event) => transformInput(event, state))

    pi.registerShortcut('alt+v', {
        description: 'Paste clipboard image',
        handler: async (ctx) => pasteImage(ctx, state),
    })
}
