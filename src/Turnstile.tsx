import { useEffect, useRef } from 'react'

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

interface TurnstileProps {
  siteKey: string
  resetKey: number
  onToken: (token: string) => void
}

export function Turnstile({ siteKey, resetKey, onToken }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const callbackRef = useRef(onToken)
  callbackRef.current = onToken

  useEffect(() => {
    if (!siteKey || !containerRef.current) return
    let active = true
    let script = document.querySelector<HTMLScriptElement>('#turnstile-script')

    const render = () => {
      if (!active || !window.turnstile || !containerRef.current) return
      if (widgetIdRef.current) window.turnstile.remove(widgetIdRef.current)
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'auto',
        size: 'flexible',
        callback: (token: string) => callbackRef.current(token),
        'expired-callback': () => callbackRef.current(''),
        'error-callback': () => callbackRef.current(''),
      })
    }

    if (!script) {
      script = document.createElement('script')
      script.id = 'turnstile-script'
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
    script.addEventListener('load', render)
    if (window.turnstile) render()

    return () => {
      active = false
      script?.removeEventListener('load', render)
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current)
      widgetIdRef.current = null
    }
  }, [siteKey, resetKey])

  return <div className="turnstile-wrap" ref={containerRef} aria-label="Security check" />
}
