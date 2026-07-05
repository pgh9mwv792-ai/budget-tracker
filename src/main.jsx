import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Note: React.StrictMode is intentionally NOT used here. In development it
// double-mounts components, which makes Plaid Link initialize twice ("script
// embedded more than once") and can stop the onSuccess callback from firing
// after you finish connecting a bank.
createRoot(document.getElementById('root')).render(<App />)
