import { jsonrepair } from 'jsonrepair';
import { z } from 'zod';

/**
 * Generic video prompt spec: the normalized shape the compiler and the UI share.
 * Only the six MVP groups are modelled here; duration/aspect ratio/resolution
 * stay in the compile params so the parameter panel owns them.
 */
export type VideoPromptStyle = 'structured' | 'compact' | 'auto';

export type VideoFramingShot =
  | 'wide'
  | 'full'
  | 'medium'
  | 'close_up'
  | 'extreme_close_up';

export type VideoCameraAngle = 'eye_level' | 'low' | 'high' | 'top' | 'dutch';

export type VideoRootMotion = 'in_place' | 'translate';

export type VideoLoopSeam = 'closed' | 'open' | 'mirror';

export type VideoBackgroundType = 'solid' | 'scene' | 'chroma';

export interface VideoPromptBeat {
  /** Normalized start of the beat, 0-1. */
  start: number;
  /** Normalized end of the beat, 0-1. */
  end: number;
  description: string;
}

export interface VideoPromptSpec {
  subject: {
    description: string;
    mustKeep?: string[];
    mustNotChange?: string[];
  };
  framing: {
    shot?: VideoFramingShot;
    subjectHeightRatio?: number;
    marginRatio?: number;
  };
  camera: {
    locked?: boolean;
    angle?: VideoCameraAngle;
    lens?: string;
    movement?: string;
  };
  motion: {
    beats?: VideoPromptBeat[];
    secondary?: string[];
    rootMotion?: VideoRootMotion;
    loopSeam?: VideoLoopSeam;
    locomotion?: boolean;
    suspended?: boolean;
  };
  style: {
    render?: string;
    lighting?: string;
    palette?: string[];
    negativeStyle?: string[];
  };
  background?: {
    type: VideoBackgroundType;
    color?: string;
    description?: string;
  };
  negative: string[];
  promptStyle?: VideoPromptStyle;
  /** System-filled defaults, surfaced to the user instead of staying implicit. */
  assumed?: string[];
}

export type VideoPromptSpecParseWarningCode = 'video.spec.warning.repaired';

export interface VideoPromptSpecParseWarning {
  code: VideoPromptSpecParseWarningCode;
  params?: Record<string, unknown>;
}

export type VideoPromptSpecParseErrorCode =
  | 'video.spec.error.empty'
  | 'video.spec.error.too_large'
  | 'video.spec.error.invalid_json'
  | 'video.spec.error.invalid_schema';

export type VideoPromptSpecParseResult =
  | {
      ok: true;
      spec: VideoPromptSpec;
      warnings: VideoPromptSpecParseWarning[];
    }
  | {
      ok: false;
      code: VideoPromptSpecParseErrorCode;
      warnings: VideoPromptSpecParseWarning[];
    };

export const VIDEO_PROMPT_SPEC_MAX_CHARS = 64 * 1024;
export const VIDEO_PROMPT_SPEC_MAX_TEXT = 2000;
export const VIDEO_PROMPT_SPEC_MAX_ITEM = 400;
export const VIDEO_PROMPT_SPEC_MAX_LIST = 24;

const shotSchema = z.enum(['wide', 'full', 'medium', 'close_up', 'extreme_close_up']);
const angleSchema = z.enum(['eye_level', 'low', 'high', 'top', 'dutch']);
const rootMotionSchema = z.enum(['in_place', 'translate']);
const loopSeamSchema = z.enum(['closed', 'open', 'mirror']);
const backgroundTypeSchema = z.enum(['solid', 'scene', 'chroma']);
const promptStyleSchema = z.enum(['structured', 'compact', 'auto']);

const textSchema = z.string();
const itemSchema = z.string();

const beatSchema = z.object({
  start: z.number(),
  end: z.number(),
  description: itemSchema,
});

/**
 * Input contract. Optional groups and arrays keep the parser tolerant; the
 * normalizer below decides what survives and fills the stable output shape.
 */
const promptSpecSchema = z.object({
  subject: z.object({
    description: textSchema,
    mustKeep: z.array(itemSchema).optional(),
    mustNotChange: z.array(itemSchema).optional(),
  }),
  framing: z
    .object({
      shot: shotSchema.optional(),
      subjectHeightRatio: z.number().optional(),
      marginRatio: z.number().optional(),
    })
    .optional(),
  camera: z
    .object({
      locked: z.boolean().optional(),
      angle: angleSchema.optional(),
      lens: itemSchema.optional(),
      movement: itemSchema.optional(),
    })
    .optional(),
  motion: z
    .object({
      beats: z.array(beatSchema).optional(),
      secondary: z.array(itemSchema).optional(),
      rootMotion: rootMotionSchema.optional(),
      loopSeam: loopSeamSchema.optional(),
      locomotion: z.boolean().optional(),
      suspended: z.boolean().optional(),
    })
    .optional(),
  style: z
    .object({
      render: textSchema.optional(),
      lighting: textSchema.optional(),
      palette: z.array(itemSchema).optional(),
      negativeStyle: z.array(itemSchema).optional(),
    })
    .optional(),
  background: z
    .object({
      type: backgroundTypeSchema.optional(),
      color: itemSchema.optional(),
      description: textSchema.optional(),
    })
    .optional(),
  negative: z.array(itemSchema).optional(),
  promptStyle: promptStyleSchema.optional(),
  assumed: z.array(itemSchema).optional(),
});

type RawPromptSpec = z.infer<typeof promptSpecSchema>;

const cleanText = (value: string | undefined, max: number): string | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};

const cleanList = (
  values: readonly string[] | undefined,
  max: number,
  maxItem = VIDEO_PROMPT_SPEC_MAX_ITEM,
): string[] | undefined => {
  if (!values) return undefined;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = cleanText(value, maxItem);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= max) break;
  }
  return result.length > 0 ? result : undefined;
};

const clampRatio = (value: number | undefined): number | undefined => {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
};

const normalizeBeats = (beats: readonly z.infer<typeof beatSchema>[] | undefined) => {
  if (!beats) return undefined;
  const normalized: VideoPromptBeat[] = [];
  for (const beat of beats) {
    const description = cleanText(beat.description, VIDEO_PROMPT_SPEC_MAX_ITEM);
    if (!description) continue;
    const start = clampRatio(beat.start);
    const end = clampRatio(beat.end);
    if (start === undefined || end === undefined || end <= start) continue;
    normalized.push({ start, end, description });
  }
  if (normalized.length === 0) return undefined;
  normalized.sort((left, right) => left.start - right.start);
  return normalized.slice(0, VIDEO_PROMPT_SPEC_MAX_LIST);
};

const normalizeSpec = (raw: RawPromptSpec): VideoPromptSpec => {
  const assumed = cleanList(raw.assumed, VIDEO_PROMPT_SPEC_MAX_LIST) ?? [];

  const mustKeep = cleanList(raw.subject.mustKeep, VIDEO_PROMPT_SPEC_MAX_LIST);
  const mustNotChange = cleanList(raw.subject.mustNotChange, VIDEO_PROMPT_SPEC_MAX_LIST);
  const framing: VideoPromptSpec['framing'] = {};
  const subjectHeightRatio = clampRatio(raw.framing?.subjectHeightRatio);
  if (subjectHeightRatio !== undefined) framing.subjectHeightRatio = subjectHeightRatio;
  const marginRatio = clampRatio(raw.framing?.marginRatio);
  if (marginRatio !== undefined) framing.marginRatio = marginRatio;
  if (raw.framing?.shot) framing.shot = raw.framing.shot;

  const camera: VideoPromptSpec['camera'] = {};
  if (raw.camera?.locked !== undefined) camera.locked = raw.camera.locked;
  if (raw.camera?.angle) camera.angle = raw.camera.angle;
  const lens = cleanText(raw.camera?.lens, VIDEO_PROMPT_SPEC_MAX_ITEM);
  if (lens) camera.lens = lens;
  const movement = cleanText(raw.camera?.movement, VIDEO_PROMPT_SPEC_MAX_ITEM);
  if (movement) camera.movement = movement;

  const motion: VideoPromptSpec['motion'] = {};
  const beats = normalizeBeats(raw.motion?.beats);
  if (beats) motion.beats = beats;
  const secondary = cleanList(raw.motion?.secondary, VIDEO_PROMPT_SPEC_MAX_LIST);
  if (secondary) motion.secondary = secondary;
  if (raw.motion?.rootMotion) motion.rootMotion = raw.motion.rootMotion;
  if (raw.motion?.loopSeam) motion.loopSeam = raw.motion.loopSeam;
  if (raw.motion?.locomotion !== undefined) motion.locomotion = raw.motion.locomotion;
  if (raw.motion?.suspended !== undefined) motion.suspended = raw.motion.suspended;

  const style: VideoPromptSpec['style'] = {};
  const render = cleanText(raw.style?.render, VIDEO_PROMPT_SPEC_MAX_TEXT);
  if (render) style.render = render;
  const lighting = cleanText(raw.style?.lighting, VIDEO_PROMPT_SPEC_MAX_TEXT);
  if (lighting) style.lighting = lighting;
  const palette = cleanList(raw.style?.palette, VIDEO_PROMPT_SPEC_MAX_LIST);
  if (palette) style.palette = palette;
  const negativeStyle = cleanList(raw.style?.negativeStyle, VIDEO_PROMPT_SPEC_MAX_LIST);
  if (negativeStyle) style.negativeStyle = negativeStyle;

  const spec: VideoPromptSpec = {
    subject: {
      description: cleanText(raw.subject.description, VIDEO_PROMPT_SPEC_MAX_TEXT) ?? '',
      ...(mustKeep ? { mustKeep } : {}),
      ...(mustNotChange ? { mustNotChange } : {}),
    },
    framing,
    camera,
    motion,
    style,
    negative: cleanList(raw.negative, VIDEO_PROMPT_SPEC_MAX_LIST) ?? [],
  };

  if (raw.background) {
    if (!raw.background.type) assumed.push('background.type');
    const color = cleanText(raw.background.color, VIDEO_PROMPT_SPEC_MAX_ITEM);
    const description = cleanText(raw.background.description, VIDEO_PROMPT_SPEC_MAX_TEXT);
    spec.background = {
      type: raw.background.type ?? 'scene',
      ...(color ? { color } : {}),
      ...(description ? { description } : {}),
    };
  }

  if (raw.promptStyle) spec.promptStyle = raw.promptStyle;

  const finalAssumed = cleanList(assumed, VIDEO_PROMPT_SPEC_MAX_LIST);
  if (finalAssumed) spec.assumed = finalAssumed;

  return spec;
};

/** Drop nulls and trim strings before validation, matching typical LLM output. */
const MAX_JSON_DEPTH = 32;

const normalizeJsonValue = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_JSON_DEPTH) return undefined;
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== null)
      .map((item) => normalizeJsonValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === null) continue;
      const normalized = normalizeJsonValue(item, depth + 1);
      if (normalized !== undefined) result[key] = normalized;
    }
    return result;
  }
  return value;
};

/** Models sometimes wrap the spec in `{ "videoPromptSpec": { ... } }`. */
const unwrapSpecCandidate = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if ('subject' in record) return value;
  const keys = Object.keys(record);
  if (keys.length !== 1) return value;
  const inner = record[keys[0]];
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return value;
  return 'subject' in (inner as Record<string, unknown>) ? inner : value;
};

const validateSpec = (
  value: unknown,
): { spec: VideoPromptSpec; repaired: boolean } | null => {
  const unwrapped = unwrapSpecCandidate(value);
  const parsed = promptSpecSchema.safeParse(normalizeJsonValue(unwrapped));
  if (!parsed.success) return null;
  // Trimming happens in normalizeJsonValue, so only a real description survives.
  if (!parsed.data.subject.description) return null;
  return { spec: normalizeSpec(parsed.data), repaired: unwrapped !== value };
};

/**
 * Validate an already-decoded object (for session restore and tests).
 * Returns null instead of throwing so callers can fall back to plain text.
 */
export const normalizeVideoPromptSpec = (value: unknown): VideoPromptSpec | null =>
  validateSpec(value)?.spec ?? null;

interface JsonCandidate {
  text: string;
  repaired: boolean;
}

/** Scan a balanced `{...}` substring so prose before/after the JSON is ignored. */
const extractBalancedObject = (content: string, start: number): string | undefined => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return undefined;
};

const collectJsonCandidates = (content: string): JsonCandidate[] => {
  const candidates: JsonCandidate[] = [];
  const seen = new Set<string>();
  const push = (text: string, repaired: boolean) => {
    const trimmed = text.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push({ text: trimmed, repaired });
  };

  const fencedRegex = /```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```/g;
  for (const match of content.matchAll(fencedRegex)) {
    const block = (match[1] ?? '').trim();
    if (block.startsWith('{')) push(block, true);
  }

  const firstBrace = content.indexOf('{');
  if (firstBrace >= 0) {
    const balanced = extractBalancedObject(content, firstBrace);
    if (balanced) push(balanced, balanced !== content.trim());
  }

  push(content, false);
  return candidates;
};

const decodeCandidate = (
  candidate: JsonCandidate,
): { value: unknown; repaired: boolean } | undefined => {
  try {
    return { value: JSON.parse(candidate.text), repaired: candidate.repaired };
  } catch {
    // Fall through to jsonrepair.
  }
  // jsonrepair turns arbitrary prose into a JSON string; only let it touch
  // candidates that start with an object (balanced scan already handles prose).
  if (!candidate.text.startsWith('{')) return undefined;
  try {
    return { value: JSON.parse(jsonrepair(candidate.text)), repaired: true };
  } catch {
    return undefined;
  }
};

/**
 * Parse an LLM response into a normalized spec.
 * Never throws: failures return an error code so the caller can fall back to
 * plain-text optimization without blocking the user.
 */
export const parseVideoPromptSpec = (raw: unknown): VideoPromptSpecParseResult => {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, code: 'video.spec.error.empty', warnings: [] };
  }
  if (raw.length > VIDEO_PROMPT_SPEC_MAX_CHARS) {
    return { ok: false, code: 'video.spec.error.too_large', warnings: [] };
  }

  let sawJson = false;
  for (const candidate of collectJsonCandidates(raw)) {
    const decoded = decodeCandidate(candidate);
    if (!decoded) continue;
    sawJson = true;
    const validated = validateSpec(decoded.value);
    if (!validated) continue;
    const warnings: VideoPromptSpecParseWarning[] = decoded.repaired || validated.repaired
      ? [{ code: 'video.spec.warning.repaired' }]
      : [];
    return { ok: true, spec: validated.spec, warnings };
  }

  return {
    ok: false,
    code: sawJson ? 'video.spec.error.invalid_schema' : 'video.spec.error.invalid_json',
    warnings: [],
  };
};
