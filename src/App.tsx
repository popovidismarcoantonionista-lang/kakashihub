import { useApp } from './store'
import { Shell } from './shell'
import { useRoute } from './router'
import { Toasts } from './ui'
import { CortesPage } from './pages/Cortes'
import { VideosPage } from './pages/Videos'
import { EstudioPage } from './pages/Estudio'
import { UploadsPage } from './pages/Uploads'
import { IAPage } from './pages/IA'
import { Logo } from './ui'
import { LiveCapture } from './liveCapture'

function CurrentPage() {
  const { page } = useRoute()
  switch (page) {
    case 'videos': return <VideosPage />
    case 'estudio': return <EstudioPage />
    case 'uploads': return <UploadsPage />
    case 'ia': return <IAPage />
    default: return <CortesPage />
  }
}

function Boot() {
  const { state, loading, error, refresh } = useApp()

  if (!state) {
    return (
      <div className="splash">
        <Logo size={44} />
        <b>KAKASHI <span>HUB</span></b>
        {loading ? (
          <div className="splash-bar"><i /></div>
        ) : (
          <>
            <p>{error || 'Não foi possível carregar o estúdio.'}</p>
            <button className="btn btn-primary" onClick={refresh}>Tentar de novo</button>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      <Shell><CurrentPage /></Shell>
      <LiveCapture />
      <Toasts />
    </>
  )
}

function Wallpaper() {
  return (
    <div className="wallpaper" aria-hidden="true">
      <video className="bg-video" autoPlay muted loop playsInline preload="auto" poster="/bg/kakashi-eyes.jpg">
        <source src="/bg/kakashi-eyes.mp4" type="video/mp4" />
      </video>
      <img className="bg-still" src="/bg/kakashi-eyes.jpg" alt="" />
      <div className="bg-scrim" />
    </div>
  )
}

export default function App() {
  return (
    <>
      <Wallpaper />
      <Boot />
    </>
  )
}
