import { useEffect, useRef, useState } from 'react'
import { normalizeUpc } from '../lib/barcode'

// Live camera barcode scanner for the food-add sheet. Streams the rear camera
// and decodes UPC/EAN codes, preferring the browser's native BarcodeDetector
// (Chrome/Android/Edge) and lazily loading a zxing fallback only when the native
// API is missing (Safari/iOS) — so the ~200 kB decoder ships in its own chunk
// that most desktop-Chrome users never download.
//
// Props:
//   onDetected(upc): called once with the normalized digits-only code, after
//     which the parent takes over (lookup + verify). The scanner stops itself.
//   onManual(): user chose to type the code by hand instead.
const BARCODE_FORMATS = ['upc_a', 'upc_e', 'ean_13', 'ean_8', 'code_128']

export default function BarcodeScanner({ onDetected, onManual }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const stopRef = useRef(null) // cleanup for whichever decode loop is running
  const doneRef = useRef(false) // guard so we only fire onDetected once
  const [status, setStatus] = useState('starting') // starting | scanning | error
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false

    // Fully release the camera + decode loop. Safe to call more than once.
    const teardown = () => {
      try {
        stopRef.current?.()
      } catch {
        // ignore — best-effort stop
      }
      stopRef.current = null
      const stream = streamRef.current
      if (stream) for (const t of stream.getTracks()) t.stop()
      streamRef.current = null
    }

    const fire = (raw) => {
      const upc = normalizeUpc(raw)
      if (!upc || doneRef.current) return
      doneRef.current = true
      teardown()
      onDetected(upc)
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This device or browser has no camera access. Enter the barcode number by hand instead.')
        setStatus('error')
        return
      }
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
      } catch {
        if (cancelled) return
        setError('Couldn’t open the camera. Allow camera access, or type the barcode number in below.')
        setStatus('error')
        return
      }
      if (cancelled) {
        for (const t of stream.getTracks()) t.stop()
        return
      }
      streamRef.current = stream
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      video.setAttribute('playsinline', 'true') // iOS: don't go fullscreen
      try {
        await video.play()
      } catch {
        // autoplay can reject on some browsers until user gesture; the stream is
        // still live and BarcodeDetector/zxing read frames regardless.
      }
      if (cancelled) return
      setStatus('scanning')

      // Native path — fast, no download.
      if ('BarcodeDetector' in window) {
        try {
          await startNative(video, fire)
          return
        } catch {
          // fall through to zxing if the native detector errors out
        }
      }
      await startZxing(video, fire)
    }

    // BarcodeDetector: poll frames on an interval; stop the interval on teardown.
    async function startNative(video, fire) {
      // Some builds throw if given an unsupported format; intersect with what the
      // platform advertises.
      let formats = BARCODE_FORMATS
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats()
        const usable = BARCODE_FORMATS.filter((f) => supported.includes(f))
        if (usable.length) formats = usable
      } catch {
        // use our default list
      }
      const detector = new window.BarcodeDetector({ formats })
      const id = setInterval(async () => {
        if (doneRef.current) return
        try {
          const codes = await detector.detect(video)
          if (codes && codes.length) fire(codes[0].rawValue)
        } catch {
          // transient decode error on a blurry frame — keep polling
        }
      }, 250)
      stopRef.current = () => clearInterval(id)
    }

    // zxing fallback, dynamically imported so it isn't in the main bundle.
    async function startZxing(video, fire) {
      try {
        const [{ BrowserMultiFormatReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([
          import('@zxing/browser'),
          import('@zxing/library'),
        ])
        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.CODE_128,
        ])
        const reader = new BrowserMultiFormatReader(hints)
        const controls = await reader.decodeFromVideoElement(video, (result) => {
          if (result) fire(result.getText())
        })
        stopRef.current = () => controls.stop()
      } catch {
        if (!cancelled) {
          setError('Couldn’t start the barcode reader. Type the barcode number in below.')
          setStatus('error')
        }
      }
    }

    start()
    return () => {
      cancelled = true
      teardown()
    }
  }, [onDetected])

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-xl bg-slate-900 aspect-[4/3]">
        <video ref={videoRef} muted className="h-full w-full object-cover" />
        {/* Aiming reticle */}
        {status === 'scanning' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-24 w-4/5 rounded-lg border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
          </div>
        )}
        {status === 'starting' && (
          <div className="absolute inset-0 grid place-items-center text-sm text-slate-300">
            Starting camera…
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-slate-200">
            {error}
          </div>
        )}
      </div>

      {status === 'scanning' && (
        <p className="text-center text-xs text-slate-500 dark:text-slate-400">
          Point the rear camera at the barcode — it scans automatically.
        </p>
      )}

      <div className="flex justify-center">
        <button
          type="button"
          onClick={onManual}
          className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline"
        >
          Enter the barcode number by hand
        </button>
      </div>
    </div>
  )
}
