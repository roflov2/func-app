import { useEffect, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import './App.css'

async function fetchStatus() {
  try {
    const res = await fetch('/api/status', { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return { loading: false, data: await res.json(), error: null }
  } catch (err) {
    return { loading: false, data: null, error: err.message }
  }
}

function ApiStatus() {
  const [state, setState] = useState({ loading: true, data: null, error: null })

  useEffect(() => {
    let cancelled = false
    fetchStatus().then((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    setState(await fetchStatus())
  }

  return (
    <section className="card">
      <h2>
        Backend status <code>GET /api/status</code>
      </h2>
      {state.error && <p className="error">Could not reach the API: {state.error}</p>}
      {state.data && <pre className="json">{JSON.stringify(state.data, null, 2)}</pre>}
      <button type="button" className="button" onClick={refresh} disabled={state.loading}>
        {state.loading ? 'Loading…' : 'Refresh'}
      </button>
    </section>
  )
}

function Home() {
  return (
    <>
      <div className="logos">
        <img src={viteLogo} alt="Vite logo" />
        <img src={reactLogo} alt="React logo" />
      </div>
      <h1>React SPA on Azure Functions</h1>
      <p>
        This page is served by the <code>spaHandler</code> function and talks to the{' '}
        <code>apiStatus</code> function on the same origin.
      </p>
      <ApiStatus />
    </>
  )
}

function About() {
  return (
    <>
      <h1>About</h1>
      <p>
        This is a client-side route. Reload the page on <code>/about</code>: the Functions host
        has no file at that path, so the catch-all route returns <code>index.html</code> and
        React Router renders this view.
      </p>
    </>
  )
}

function NotFound() {
  const { pathname } = useLocation()
  return (
    <>
      <h1>404</h1>
      <p>
        No client-side route matches <code>{pathname}</code>. <Link to="/">Go home</Link>
      </p>
    </>
  )
}

function App() {
  return (
    <>
      <nav className="nav">
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/about">About</NavLink>
        <NavLink to="/does/not/exist">Missing page</NavLink>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </>
  )
}

export default App
