import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit' })

if (process.env.VERCEL) {
  console.log('[postinstall] ignorando ferramentas locais em build serverless')
  process.exit(0)
}

// Netlify já executa `npm run build` depois do install; rodar aqui de novo
// apenas duplicava o build e atrasava o deploy.
if (!process.env.FUGA_SKIP_BUILD && !process.env.NETLIFY) {
  const build = run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'])
  if (build.status !== 0) process.exit(build.status || 1)
}

if (process.platform === 'linux') {
  const binDir = path.join(root, '.bin')
  fs.mkdirSync(binDir, { recursive: true })

  for (const [name, pkg] of [['ffmpeg', 'ffmpeg-static'], ['ffprobe', 'ffprobe-static']]) {
    try {
      const mod = await import(pkg)
      const source = pkg === 'ffprobe-static' ? mod.default?.path || mod.path : mod.default || mod
      const link = path.join(binDir, name)
      if (typeof source === 'string' && fs.existsSync(source)) {
        try { fs.unlinkSync(link) } catch {}
        fs.symlinkSync(source, link)
      }
    } catch (err) {
      console.warn(`[postinstall] ${name} indisponivel: ${String(err?.message || err)}`)
    }
  }

  const ytdlp = path.join(binDir, 'yt-dlp')
  const ready = fs.existsSync(ytdlp) && fs.statSync(ytdlp).size > 1_000_000
  if (!ready) {
    try {
      const res = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', { redirect: 'follow' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const tmp = `${ytdlp}.tmp`
      fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()))
      fs.chmodSync(tmp, 0o755)
      fs.renameSync(tmp, ytdlp)
      console.log('[postinstall] yt-dlp pronto')
    } catch (err) {
      console.warn(`[postinstall] download do yt-dlp falhou: ${String(err?.message || err)}`)
      const check = spawnSync('python3', ['-m', 'yt_dlp', '--version'], { stdio: 'ignore' })
      if (check.status !== 0) {
        const pip = run('python3', ['-m', 'pip', 'install', '--user', '--break-system-packages', 'yt-dlp'])
        if (pip.status !== 0) console.warn('[postinstall] yt-dlp nao instalado; a analise de links pode falhar ate instalar.')
      }
    }
  }
  // ZIPs e cópias entre ambientes podem remover o bit de execução.
  if (fs.existsSync(ytdlp)) {
    try { fs.chmodSync(ytdlp, 0o755) } catch (err) {
      console.warn(`[postinstall] não foi possível marcar yt-dlp como executável: ${String(err?.message || err)}`)
    }
  }

  const pyHome = path.join(root, '.pyhost')
  fs.rmSync(pyHome, { recursive: true, force: true })
  fs.mkdirSync(pyHome, { recursive: true })
  console.log('[postinstall] instalando dependencias do downloader')
  const reqs = path.join(root, 'downloader', 'requirements.txt')
  let pip = run('python3', ['-m', 'pip', 'install', '--target', pyHome, '-r', reqs])
  if (pip.status !== 0) pip = run('python3', ['-m', 'pip', 'install', '--break-system-packages', '--target', pyHome, '-r', reqs])
  if (pip.status !== 0) console.warn(`[postinstall] downloader nao instalado (pip ${pip.status}); o servico interno pode falhar.`)
  else console.log('[postinstall] downloader pronto')
}
