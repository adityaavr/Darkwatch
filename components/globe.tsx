"use client"

import { useEffect, useRef } from "react"
import createGlobe from "cobe"
import { cn } from "@/lib/utils"

interface GlobeProps {
  className?: string
  isScanning?: boolean
}

export function Globe({ className, isScanning = false }: GlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const globeRef = useRef<any>(null)
  const phiRef = useRef(0)
  const animationRef = useRef<number>(0)
  const isScanningRef = useRef(isScanning)

  // Keep scanning state in sync with ref
  useEffect(() => {
    isScanningRef.current = isScanning
  }, [isScanning])

  useEffect(() => {
    if (!canvasRef.current) return

    const globe = createGlobe(canvasRef.current, {
      devicePixelRatio: 2,
      width: 800 * 2,
      height: 800 * 2,
      phi: 0,
      theta: 0.2,
      dark: 0,
      diffuse: 1.0,
      mapSamples: 16000,
      mapBrightness: 4,
      baseColor: [0.82, 0.82, 0.8],
      markerColor: [0, 0, 0],
      glowColor: [0.3, 0.5, 1.0],
      markers: [],
    })

    globeRef.current = globe

    // Animate the globe
    function animate() {
      if (!globeRef.current) return
      
      // Use ref to get current scanning state
      const currentlyScanning = isScanningRef.current
      
      // Slow rotation normally, faster when scanning
      phiRef.current += currentlyScanning ? 0.02 : 0.005
      
      // Update colors and rotation based on scanning state
      globeRef.current.update({
        phi: phiRef.current,
        glowColor: currentlyScanning ? [1, 0.3, 0.3] : [0.3, 0.5, 1.0],
        mapBrightness: currentlyScanning ? 6 : 4,
        diffuse: currentlyScanning ? 1.3 : 1.0,
      })
      
      animationRef.current = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      globe.destroy()
    }
  }, [])

  return (
    <div className={cn("w-full h-full relative", className)}>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          maxWidth: "100%",
          display: "block",
        }}
      />
      
    </div>
  )
}