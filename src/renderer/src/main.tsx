import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { App } from './App'

// No StrictMode: AppWindow streams model HTML into an iframe imperatively (document.write),
// and StrictMode's double-invoked effects would double-open that document in dev.
createRoot(document.getElementById('root')!).render(<App />)
