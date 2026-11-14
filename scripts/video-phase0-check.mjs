/**
 * Phase 0 probe for the Volcano Ark video API.
 *
 * Creates one text-to-video task, polls it to completion and downloads the
 * result. No dependencies, no key in the source: the key comes from
 * ARK_API_KEY / VITE_ARK_API_KEY in the environment.
 *
 *   node scripts/video-phase0-check.mjs --prompt "..." --ratio 3:4 --duration 4
 *
 * Writes nothing into the repo by default (outputs go to --out / --json).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const BASE = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3'
const MODEL = 'doubao-seedance-2-0-fast-260128'

function parseArgs(argv) {
  const args = {
    prompt: '一只蓝发少女站在纯绿背景前，轻轻挥手，固定机位，全身入画',
    ratio: '3:4',
    resolution: '480p',
    duration: 4,
    model: MODEL,
    out: '',
    json: '',
    pollMs: 5000,
    timeoutMs: 8 * 60 * 1000,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    const next = () => argv[++i]
    if (key === '--prompt') args.prompt = next()
    else if (key === '--ratio') args.ratio = next()
    else if (key === '--resolution') args.resolution = next()
    else if (key === '--duration') args.duration = Number(next())
    else if (key === '--model') args.model = next()
    else if (key === '--out') args.out = next()
    else if (key === '--json') args.json = next()
    else if (key === '--poll-ms') args.pollMs = Number(next())
    else if (key === '--timeout-ms') args.timeoutMs = Number(next())
  }
  return args
}

function key() {
  const value = process.env.ARK_API_KEY || process.env.VITE_ARK_API_KEY
  if (value) return value.trim()
  return readKeyFromEnvFile()
}

/** Fallback: .env.local is gitignored, so a single key line there is fine. */
function readKeyFromEnvFile() {
  try {
    const text = readFileSync(join(process.cwd(), '.env.local'), 'utf8').trim()
    const match = text.match(/^(?:ARK_API_KEY|VITE_ARK_API_KEY)\s*=\s*(.+)$/m)
    if (match) return match[1].trim()
    // a bare key on its own line (no KEY= prefix)
    if (!text.includes('=') && text.length > 0) return text
  } catch {
    /* no file */
  }
  console.error('missing ARK_API_KEY (env or .env.local)')
  process.exit(2)
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}`)
    err.payload = data
    throw err
  }
  return data
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const request = {
    model: args.model,
    content: [{ type: 'text', text: args.prompt }],
    ratio: args.ratio,
    resolution: args.resolution,
    duration: args.duration,
    generate_audio: false,
    watermark: false,
  }

  console.log('[phase0] model   ', request.model)
  console.log('[phase0] params  ', request.ratio, request.resolution, `${request.duration}s`, 'audio=off')

  const created = await call('POST', '/contents/generations/tasks', request)
  const id = created.id
  console.log('[phase0] task id ', id)

  const started = Date.now()
  let last = ''
  let job
  for (;;) {
    await sleep(args.pollMs)
    job = await call('GET', `/contents/generations/tasks/${id}`)
    const status = job.status || 'unknown'
    const elapsed = Math.round((Date.now() - started) / 1000)
    if (status !== last) {
      console.log(`[phase0] ${String(elapsed).padStart(3)}s  ${status}`)
      last = status
    }
    if (status === 'succeeded' || status === 'failed' || status === 'expired') break
    if (Date.now() - started > args.timeoutMs) {
      console.log('[phase0] timeout while polling')
      break
    }
  }

  const summary = {
    request,
    taskId: id,
    status: job?.status,
    duration: job?.duration ?? job?.content?.duration,
    resolution: job?.resolution ?? job?.content?.resolution,
    ratio: job?.ratio ?? job?.content?.ratio,
    videoUrl: job?.content?.video_url,
    lastFrameUrl: job?.content?.last_frame_url,
    usage: job?.usage,
    error: job?.error,
  }
  console.log('[phase0] summary ', JSON.stringify(summary, null, 2))

  if (args.json) {
    await mkdir(dirname(args.json), { recursive: true })
    await writeFile(args.json, `${JSON.stringify({ created, job }, null, 2)}\n`, 'utf8')
    console.log('[phase0] raw json', args.json)
  }

  if (job?.status === 'succeeded' && job?.content?.video_url) {
    const res = await fetch(job.content.video_url)
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    const target = args.out || join(process.cwd(), 'video-phase0.mp4')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, buf)
    console.log(`[phase0] video ${target} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`)
  }

  process.exit(job?.status === 'succeeded' ? 0 : 1)
}

main().catch((error) => {
  console.error('[phase0] failed:', error.message)
  if (error.payload) console.error(JSON.stringify(error.payload, null, 2))
  process.exit(1)
})
