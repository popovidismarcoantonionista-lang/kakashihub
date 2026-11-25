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

function exec(cmd, args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, env: process.env })
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
 */
export async function transcribeXracing(videoPath) {
  if (!fs.existsSync(TRANSCRIBE_SCRIPT)) throw new Error('transcriber-missing')
  const wav = path.join(os.tmpdir(), `xracing-${process.pid}-${Date.now()}.wav`)
  try {
    // O free do Render não aguenta transcrever um vídeo longo inteiro. O
    // padrão cobre 10 min (de onde vêm os cortes); ajuste por XRACING_MAX_AUDIO_SEC.
    const maxAudio = Math.min(3600, Math.max(30, Number(process.env.XRACING_MAX_AUDIO_SEC) || 600))
    await exec(FFMPEG_BIN, [
      '-y', '-v', 'error', '-i', videoPath, '-t', String(maxAudio),
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav,
    ], 1000 * 60 * 4)
    const stdout = await exec(PYTHON, [TRANSCRIBE_SCRIPT, wav], 1000 * 60 * 12)
    const lines = stdout.split(/\r?\n/).filter(Boolean)
    const payload = JSON.parse(lines[lines.length - 1] || '{}')
    if (payload.error) throw new Error(String(payload.error).slice(0, 300))
    const words = Array.isArray(payload.words) ? payload.words : []
    if (!words.length) throw new Error('transcript-empty')
    return words
  } finally {
    try { fs.unlinkSync(wav) } catch {}
  }
}
