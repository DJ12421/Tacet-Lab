import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ui/App'
import { PwaUpdatePrompt } from './ui/PwaUpdatePrompt'
import './ui/styles.css'
import './ui/step3.css'
import './ui/site-motion.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App/><PwaUpdatePrompt/></StrictMode>)
