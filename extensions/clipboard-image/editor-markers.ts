import { Editor } from '@earendil-works/pi-tui'

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Pattern matching numbered image markers like `[paste image #1]`. */
const IMAGE_MARKER_RE = /\[paste image #(\d+)\]/g

/** Symbol used to store the one-time Editor prototype patch state. */
const PATCH_STATE = Symbol.for('pi.clipboard-image.patch')

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Minimal Editor segment shape used by the patching logic. */
type SegmentDataLike = {
    segment: string
    index: number
    input: string
}

/** Inclusive-exclusive range occupied by an active image marker. */
type MarkerSpan = {
    start: number
    end: number
}

/** Shared state stored on `Editor.prototype` for the marker patch. */
type EditorPatchState = {
    getActiveMarkerIds: () => ReadonlySet<number>
    originalSegment: (this: Editor, text: string) => Iterable<SegmentDataLike>
}

/** Narrow view of the Editor prototype used for patching `segment()`. */
type PatchedEditorPrototype = {
    segment(this: Editor, text: string): Iterable<SegmentDataLike>
    [PATCH_STATE]?: EditorPatchState
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Format the editor placeholder for a pending clipboard image. */
export function formatImageMarker(index: number): string {
    return `[paste image #${index}]`
}

/** Extract the set of image indices still present in the text. */
export function findMarkerIndices(text: string): Set<number> {
    const indices = new Set<number>()

    for (const match of text.matchAll(IMAGE_MARKER_RE)) {
        indices.add(Number(match[1]))
    }

    return indices
}

/** Collect marker spans for active clipboard-image markers in the text. */
function findActiveMarkerSpans(text: string, activeMarkerIds: ReadonlySet<number>): MarkerSpan[] {
    if (activeMarkerIds.size === 0 || !text.includes('[paste image #')) {
        return []
    }

    const spans: MarkerSpan[] = []

    for (const match of text.matchAll(IMAGE_MARKER_RE)) {
        const id = Number(match[1])

        if (!activeMarkerIds.has(id) || match.index === undefined) {
            continue
        }

        spans.push({ start: match.index, end: match.index + match[0].length })
    }

    return spans
}

/** Merge all segments that fall within marker spans into single atomic markers. */
function mergeMarkerSegments(
    text: string,
    baseSegments: SegmentDataLike[],
    markerSpans: MarkerSpan[],
): SegmentDataLike[] {
    if (markerSpans.length === 0) {
        return baseSegments
    }

    const result: SegmentDataLike[] = []
    let markerIndex = 0

    for (const segment of baseSegments) {
        while (markerIndex < markerSpans.length && markerSpans[markerIndex]!.end <= segment.index) {
            markerIndex++
        }

        const marker = markerSpans[markerIndex]

        if (marker && segment.index >= marker.start && segment.index < marker.end) {
            if (segment.index === marker.start) {
                result.push({
                    segment: text.slice(marker.start, marker.end),
                    index: marker.start,
                    input: text,
                })
            }

            continue
        }

        result.push(segment)
    }

    return result
}

// -----------------------------------------------------------------------------
// Main functions
// -----------------------------------------------------------------------------

/**
 * Patch Pi's shared editor so active clipboard-image markers behave as atomic
 * units for cursor movement, deletion, and wrapping, while leaving inactive
 * marker-like text untouched.
 */
export function installClipboardImageMarkerPatch(
    getActiveMarkerIds: () => ReadonlySet<number>,
): void {
    const editorProto = Editor.prototype as unknown as PatchedEditorPrototype
    const existingPatch = editorProto[PATCH_STATE]

    if (existingPatch) {
        existingPatch.getActiveMarkerIds = getActiveMarkerIds
        return
    }

    const originalSegment = editorProto.segment

    editorProto[PATCH_STATE] = {
        getActiveMarkerIds,
        originalSegment: originalSegment as EditorPatchState['originalSegment'],
    }

    editorProto.segment = function patchedSegment(text: string): SegmentDataLike[] {
        const patchState = editorProto[PATCH_STATE]

        if (!patchState) {
            return [...originalSegment.call(this, text)]
        }

        const markerSpans = findActiveMarkerSpans(text, patchState.getActiveMarkerIds())
        const baseSegments = [...patchState.originalSegment.call(this, text)]

        return mergeMarkerSegments(text, baseSegments, markerSpans)
    }
}
