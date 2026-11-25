import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PYTHON = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
const FFMPEG_LOCAL_BIN = path.join(APP_ROOT, '.bin', 'ffmpeg')
const FFMPEG_BIN = process.env.FFMPEG_BIN || (fs.existsSync(FFMPEG_LOCAL_BIN) ? FFMPEG_LOCAL_BIN : 'ffmpeg')
const TRANSCRIBE_SCRIPT = path.join(APP_ROOT, 'server', 'xracing_transcribe.py')

function exec(cmd, args, timeout, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, ...extraEnv } })
    const out = []
    const err = []
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')) }, timeout)
    child.stdout?.on('data', (d) => out.push(d))
    child.stderr?.on('data', (d) => { if (err.length < 100) err.push(d) })
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const stdout = Buffer.concat(out).toString()
      const stderr = Buffer.concat(err).toString()
      if (code === 0) resolve(stdout)
      else reject(Object.assign(new Error(stderr.slice(-500) || `exit ${code}`), { code, stderr }))
    })
  })
}

/**
 * Transcreve o vídeo localmente com faster-whisper e devolve palavras com
 * timestamp absoluto. Nenhum áudio ou texto sai do serviço.
 *
 * Vídeos longos são amostrados em três janelas espalhadas pelo arquivo, numa
 * única carga do modelo. Assim um MP4 de 12 min não fica 12 min parado na
 * transcrição e ainda assim a abertura, o meio e o final entram na análise.
 */
export async function transcribeXracing(videoPath, opts = {}) {
  if (!fs.existsSync(TRANSCRIBE_SCRIPT)) throw new Error('transcriber-missing')
  // Padrão reduzido de 600s para 180s: no Render free 600s passava dos 12 min
  // e caía no timeout (o job seguia sem transcrição e o usuário via só "processando").
  const maxAudio = Math.min(3600, Math.max(30, Number(process.env.XRACING_MAX_AUDIO_SEC) || 180))
  const duration = Math.max(0, Number(opts.duration) || 0)
  const onTick = typeof opts.onTick === 'function' ? opts.onTick : null
  const chunks = duration > maxAudio + 20 ? 3 : 1
  const chunkLen = Math.max(30, Math.round(maxAudio / chunks))
  const starts = []
  if (chunks === 1) {
    starts.push(0)
  } else {
    for (let i = 0; i < chunks; i++) {
      const ratio = i / (chunks - 1)
      starts.push(Math.max(0, Math.round(Math.min(duration - chunkLen, duration * ratio) * 10) / 10))
    }
  }

  const prefix = `xracing-${process.pid}-${Date.now()}`
  const configPath = path.join(os.tmpdir(), `${prefix}.json`)
  const wavs = []
  try {
    for (let i = 0; i < starts.length; i++) {
      const wav = path.join(os.tmpdir(), `${prefix}-${i}.wav`)
      await exec(FFMPEG_BIN, [
        '-y', '-v', 'error', '-ss', String(starts[i]), '-i', videoPath,
        '-t', String(chunkLen), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav,
      ], 1000 * 60 * 3)
      wavs.push({ path: wav, offset: starts[i] })
    }
    fs.writeFileSync(configPath, JSON.stringify({ files: wavs }))

    let seconds = 0
    const ticker = onTick ? setInterval(() => onTick((seconds += 4)), 4000) : null
    ticker?.unref?.()
    let stdout
    try {
      stdout = await exec(PYTHON, [TRANSCRIBE_SCRIPT, configPath], 1000 * 60 * 6, {
        PYTHONIOENCODING: 'utf-8',
      })
    } finally {
      if (ticker) clearInterval(ticker)
    }
    const lines = stdout.split(/\r?\n/).filter(Boolean)
    const payload = JSON.parse(lines[lines.length - 1] || '{}')
    if (payload.error) throw new Error(String(payload.error).slice(0, 300))
    const words = Array.isArray(payload.words) ? payload.words : []
    if (!words.length) throw new Error('transcript-empty')
    return words
  } finally {
    for (const item of wavs) { try { fs.unlinkSync(item.path) } catch {} }
    try { fs.unlinkSync(configPath) } catch {}
  }
}
