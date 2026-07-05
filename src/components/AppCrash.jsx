// Friendly full-screen fallback shown if the app throws an unrecoverable render
// error (rendered by the Sentry ErrorBoundary in main.jsx). Uses inline styles
// so it still renders even if the stylesheet failed to load.
export default function AppCrash() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        padding: '24px',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
        color: '#e2e8f0',
        background: '#0b1120',
      }}
    >
      <h1 style={{ fontSize: '20px', fontWeight: 600 }}>Something went wrong</h1>
      <p style={{ fontSize: '14px', color: '#94a3b8', maxWidth: '360px' }}>
        The app hit an unexpected error. Your data is safe. Reloading usually fixes it.
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: '8px',
          padding: '10px 20px',
          borderRadius: '8px',
          border: 'none',
          background: '#059669',
          color: 'white',
          fontSize: '14px',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Reload
      </button>
    </div>
  )
}
