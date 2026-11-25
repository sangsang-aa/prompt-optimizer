import { describe, expect, it } from 'vitest'

import {
  VIDEO_PROMPT_SPEC_MAX_CHARS,
  normalizeVideoPromptSpec,
  parseVideoPromptSpec,
} from '../../../src/services/video/prompt-spec'

const minimal = {
  subject: { description: 'a black cat walking through rain at night' },
  negative: ['blurry'],
}

describe('video prompt spec parsing', () => {
  it('accepts plain JSON and fills the stable group shape', () => {
    const result = parseVideoPromptSpec(JSON.stringify(minimal))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    expect(result.spec.subject.description).toBe('a black cat walking through rain at night')
    expect(result.spec.framing).toEqual({})
    expect(result.spec.camera).toEqual({})
    expect(result.spec.motion).toEqual({})
    expect(result.spec.style).toEqual({})
    expect(result.spec.negative).toEqual(['blurry'])
    expect(result.spec.background).toBeUndefined()
  })

  it('extracts fenced JSON from prose and repairs trailing commas and nulls', () => {
    const raw = [
      'Here is the spec:',
      '```json',
      '{',
      '  "subject": { "description": "  a paper boat on a river  ", "mustKeep": ["red sails", null], },',
      '  "camera": null,',
      '}',
      '```',
    ].join('\n')
    const result = parseVideoPromptSpec(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.subject.description).toBe('a paper boat on a river')
    expect(result.spec.subject.mustKeep).toEqual(['red sails'])
    expect(result.spec.camera).toEqual({})
    expect(result.warnings).toEqual([{ code: 'video.spec.warning.repaired' }])
  })

  it('unwraps a single-key wrapper and reports the repair', () => {
    const raw = JSON.stringify({ videoPromptSpec: minimal })
    const result = parseVideoPromptSpec(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.subject.description).toBe(minimal.subject.description)
    expect(result.warnings).toEqual([{ code: 'video.spec.warning.repaired' }])
  })

  it('trims, dedupes and caps lists while dropping unknown keys', () => {
    const raw = {
      subject: {
        description: ' a lighthouse ',
        mustKeep: [' red roof ', 'red roof', '', 'white walls'],
      },
      negative: [' flat lighting ', 'Flat Lighting', 'extra noise'],
      style: { palette: ['#ff0000', '#FF0000', '#00ff00'] },
      unexpected: 'ignored',
    }
    const result = parseVideoPromptSpec(JSON.stringify(raw))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.subject.description).toBe('a lighthouse')
    expect(result.spec.subject.mustKeep).toEqual(['red roof', 'white walls'])
    expect(result.spec.negative).toEqual(['flat lighting', 'extra noise'])
    expect(result.spec.style.palette).toEqual(['#ff0000', '#00ff00'])
    expect(result.spec).not.toHaveProperty('unexpected')
  })

  it('clamps ratios and normalizes beats', () => {
    const raw = {
      ...minimal,
      framing: { shot: 'close_up', subjectHeightRatio: 1.4, marginRatio: -0.2 },
      motion: {
        beats: [
          { start: 0.8, end: 1.2, description: 'second' },
          { start: -0.5, end: 0.25, description: 'first' },
          { start: 0.5, end: 0.5, description: 'empty range' },
          { start: 0.1, end: 0.9, description: ' ' },
        ],
        loopSeam: 'closed',
        suspended: false,
      },
    }
    const result = parseVideoPromptSpec(JSON.stringify(raw))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.framing).toEqual({ shot: 'close_up', subjectHeightRatio: 1, marginRatio: 0 })
    expect(result.spec.motion.beats).toEqual([
      { start: 0, end: 0.25, description: 'first' },
      { start: 0.8, end: 1, description: 'second' },
    ])
    expect(result.spec.motion.loopSeam).toBe('closed')
    expect(result.spec.motion.suspended).toBe(false)
  })

  it('defaults the background type and records it as assumed', () => {
    const raw = { ...minimal, background: { color: '#101010' } }
    const result = parseVideoPromptSpec(JSON.stringify(raw))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.background).toEqual({ type: 'scene', color: '#101010' })
    expect(result.spec.assumed).toEqual(['background.type'])
  })

  it('keeps a valid prompt style', () => {
    const raw = { ...minimal, promptStyle: 'compact' }
    const result = parseVideoPromptSpec(JSON.stringify(raw))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.promptStyle).toBe('compact')
  })

  it('returns stable output for repeated parses', () => {
    const raw = JSON.stringify({ ...minimal, promptStyle: 'auto' })
    const first = parseVideoPromptSpec(raw)
    const second = parseVideoPromptSpec(raw)
    expect(first).toEqual(second)
  })

  it('truncates oversized text fields instead of rejecting the spec', () => {
    const raw = { subject: { description: 'a'.repeat(3000) } }
    const result = parseVideoPromptSpec(JSON.stringify(raw))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.subject.description).toHaveLength(2000)
  })

  it('does not throw on deeply nested input', () => {
    const deep = `${'['.repeat(5000)}${']'.repeat(5000)}`
    expect(() => parseVideoPromptSpec(deep)).not.toThrow()
    expect(parseVideoPromptSpec(deep)).toMatchObject({ ok: false })
  })

  it('fails softly on empty, oversized, non-JSON and schema-invalid input', () => {
    expect(parseVideoPromptSpec('   ')).toEqual({
      ok: false,
      code: 'video.spec.error.empty',
      warnings: [],
    })
    expect(parseVideoPromptSpec('x'.repeat(VIDEO_PROMPT_SPEC_MAX_CHARS + 1))).toEqual({
      ok: false,
      code: 'video.spec.error.too_large',
      warnings: [],
    })
    expect(parseVideoPromptSpec('The model refused to answer.')).toEqual({
      ok: false,
      code: 'video.spec.error.invalid_json',
      warnings: [],
    })
    expect(parseVideoPromptSpec(JSON.stringify({ subject: {} }))).toMatchObject({
      ok: false,
      code: 'video.spec.error.invalid_schema',
    })
    expect(parseVideoPromptSpec(JSON.stringify({ subject: { description: '   ' } }))).toMatchObject({
      ok: false,
      code: 'video.spec.error.invalid_schema',
    })
    expect(parseVideoPromptSpec(JSON.stringify({ ...minimal, promptStyle: 'cinematic' }))).toMatchObject({
      ok: false,
      code: 'video.spec.error.invalid_schema',
    })
  })

  it('normalizes decoded objects for session restore', () => {
    expect(normalizeVideoPromptSpec(minimal)?.subject.description).toBe(minimal.subject.description)
    expect(normalizeVideoPromptSpec({ negative: [] })).toBeNull()
    expect(normalizeVideoPromptSpec(null)).toBeNull()
  })
})
