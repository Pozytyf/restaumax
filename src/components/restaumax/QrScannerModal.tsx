import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Camera, X, AlertCircle, QrCode, RefreshCw, CheckCircle2, Zap, Play, Square } from 'lucide-react';
import jsQR from 'jsqr';
import { sounds } from '../../utils/audio';

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanResult: (targetPath: string) => void;
  autoStartScan?: boolean;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({ 
  isOpen, 
  onClose, 
  onScanResult,
  autoStartScan = true 
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scanningRef = useRef(false);
  const cameraRequestRef = useRef(0);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [autoScanEnabled, setAutoScanEnabled] = useState(autoStartScan);
  const [cameraReady, setCameraReady] = useState(false);
  const [isScanningActive, setIsScanningActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState(false);

  // Sync autoScanEnabled with prop when modal opens
  useEffect(() => {
    if (isOpen) {
      setAutoScanEnabled(autoStartScan);
    }
  }, [isOpen, autoStartScan]);

  const stopCamera = useCallback(() => {
    // Invalidate any pending getUserMedia request so a late permission grant
    // cannot leave the camera running after the modal has closed.
    cameraRequestRef.current += 1;
    scanningRef.current = false;
    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }
    setIsScanningActive(false);
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  const handleValidTokenScanned = useCallback((tokenPath: string) => {
    scanningRef.current = false;
    setIsScanningActive(false);
    setFeedback(true);
    try {
      sounds.playSuccess();
    } catch {
      // Audio playback might be muted or constrained
    }
    successTimeoutRef.current = setTimeout(() => {
      successTimeoutRef.current = null;
      stopCamera();
      onScanResult(tokenPath);
      onClose();
    }, 400);
  }, [onClose, onScanResult, stopCamera]);

  const startScanningLoop = useCallback(() => {
    if (!videoRef.current) return;
    scanningRef.current = true;
    setIsScanningActive(true);

    const Detector = (window as any).BarcodeDetector;
    let nativeDetector: any = null;
    if (Detector) {
      try {
        nativeDetector = new Detector({ formats: ['qr_code'] });
      } catch {
        nativeDetector = null;
      }
    }

    const processFrame = async () => {
      if (!scanningRef.current || !videoRef.current) return;

      if (videoRef.current.readyState >= 2 && videoRef.current.videoWidth > 0) {
        let detectedRawValue: string | null = null;

        // 1. Try native BarcodeDetector if available
        if (nativeDetector) {
          try {
            const codes = await nativeDetector.detect(videoRef.current);
            if (codes?.[0]?.rawValue) {
              detectedRawValue = codes[0].rawValue;
            }
          } catch {
            // Fall back to jsQR
          }
        }

        // 2. Fall back to pure JS QR engine (jsQR)
        if (!detectedRawValue && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
          try {
            if (!canvasRef.current) {
              canvasRef.current = document.createElement('canvas');
            }
            const canvas = canvasRef.current;
            const width = videoRef.current.videoWidth;
            const height = videoRef.current.videoHeight;
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(videoRef.current, 0, 0, width, height);
              const imageData = ctx.getImageData(0, 0, width, height);
              const qrResult = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert'
              });
              if (qrResult?.data) {
                detectedRawValue = qrResult.data;
              }
            }
          } catch {
            // Ignore frame capture error and try next frame
          }
        }

        // 3. Process detected value
        if (detectedRawValue) {
          let parsed: URL;
          try {
            parsed = new URL(detectedRawValue, window.location.origin);
          } catch {
            setCameraError('QR code illisible ou format invalide.');
            return;
          }

          const tokenMatch = parsed.pathname.match(/^\/q\/([A-Za-z0-9_-]{40,100})\/?$/);
          if (parsed.origin !== window.location.origin || !tokenMatch || parsed.search || parsed.hash) {
            setCameraError("Ce QR code n'est pas un QR de table RestauMax valide pour ce domaine.");
          } else {
            handleValidTokenScanned(parsed.pathname);
            return;
          }
        }
      }

      if (scanningRef.current) {
        frameRef.current = requestAnimationFrame(processFrame);
      }
    };

    frameRef.current = requestAnimationFrame(processFrame);
  }, [handleValidTokenScanned]);

  const initCamera = useCallback(async () => {
    const requestId = ++cameraRequestRef.current;
    setCameraError(null);
    setFeedback(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("La caméra n'est pas accessible sur cet appareil. Scannez le QR physique avec l'application photo de votre téléphone.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { 
          facingMode: { ideal: 'environment' }, 
          width: { ideal: 1280 }, 
          height: { ideal: 720 } 
        }
      });

      // The user may have closed the modal or disabled scanning while the
      // browser permission prompt was still open. Always release late streams.
      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
      startScanningLoop();
    } catch (error: any) {
      if (requestId !== cameraRequestRef.current) return;
      const name = error?.name || '';
      if (name === 'NotAllowedError') {
        setCameraError("L'accès à la caméra a été refusé. Veuillez autoriser la caméra dans les paramètres de votre navigateur.");
      } else if (name === 'NotFoundError') {
        setCameraError("Aucune caméra n'a été détectée sur votre appareil.");
      } else {
        setCameraError("Impossible d'activer la caméra. Utilisez l'appareil photo natif de votre téléphone.");
      }
    }
  }, [startScanningLoop]);

  // Main effect: start immediately if autoScanEnabled is true
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    if (autoScanEnabled) {
      void initCamera();
    }

    return () => {
      stopCamera();
    };
  }, [isOpen, autoScanEnabled, initCamera, stopCamera]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
        
        {/* Top Header */}
        <div className="px-5 py-4 bg-[#101d2d] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ff6500]/20 text-[#ff6500] flex items-center justify-center">
              <QrCode size={20} />
            </div>
            <div>
              <h2 className="text-base font-black">Scanner le QR physique</h2>
              <p className="text-[11px] text-slate-300">Scannez uniquement le code placé sur votre table</p>
            </div>
          </div>
          <button 
            onClick={() => { stopCamera(); onClose(); }} 
            className="p-2 rounded-xl hover:bg-white/10 transition-colors" 
            aria-label="Fermer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">

          {/* Camera Viewport */}
          <div className="relative aspect-[4/3] bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center shadow-inner">
            <video 
              ref={videoRef} 
              muted 
              playsInline 
              className="w-full h-full object-cover" 
            />

            {/* Waiting for Camera */}
            {!cameraReady && !cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white bg-slate-900/90">
                <div className="w-12 h-12 rounded-full border-2 border-[#ff6500] border-t-transparent animate-spin flex items-center justify-center">
                  <Camera size={20} className="text-[#ff6500]" />
                </div>
                <span className="text-xs font-bold text-slate-300">
                  {autoScanEnabled ? 'Activation du scan automatique immédiat…' : 'Caméra en attente'}
                </span>
              </div>
            )}

            {/* Active Scanner Laser & Reticle */}
            {cameraReady && isScanningActive && !feedback && (
              <div className="absolute inset-6 border-2 border-emerald-400/80 rounded-2xl pointer-events-none shadow-[0_0_15px_rgba(52,211,153,0.3)]">
                {/* Corner Accents */}
                <div className="absolute -top-1 -left-1 w-4 h-4 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
                <div className="absolute -top-1 -right-1 w-4 h-4 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
                <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
                <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />

                {/* Animated Horizontal Laser Scanline */}
                <div className="absolute inset-x-2 top-0 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_8px_#34d399] animate-[bounce_2s_infinite]" />
              </div>
            )}

            {/* Success Feedback Overlay */}
            {feedback && (
              <div className="absolute inset-0 bg-emerald-950/90 flex flex-col items-center justify-center text-white gap-2.5 animate-in zoom-in-95 duration-200">
                <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 size={36} />
                </div>
                <span className="font-black text-sm">QR Code authentifié !</span>
                <span className="text-[11px] text-emerald-200">Ouverture de la session de table…</span>
              </div>
            )}
          </div>

          {/* Auto-Scan Immediate Setting Toggle */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="flex items-center gap-2">
              <span className={`p-1.5 rounded-lg ${autoScanEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                <Zap size={15} />
              </span>
              <div>
                <p className="text-xs font-bold text-slate-800">Scan automatique immédiat</p>
                <p className="text-[10px] text-slate-500">Active la caméra dès l'ouverture</p>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={autoScanEnabled}
                onChange={(e) => {
                  const nextVal = e.target.checked;
                  setAutoScanEnabled(nextVal);
                  if (nextVal && !cameraReady) {
                    void initCamera();
                  } else if (!nextVal && cameraReady) {
                    stopCamera();
                  }
                }}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#ff6500]"></div>
            </label>
          </div>

          {/* Manual Start Button (if auto-scan disabled) */}
          {!autoScanEnabled && !cameraReady && (
            <button
              onClick={() => void initCamera()}
              className="w-full py-2.5 rounded-xl bg-[#101d2d] text-white text-xs font-bold flex items-center justify-center gap-2 hover:bg-[#1a2d42] transition-colors"
            >
              <Play size={14} />
              <span>Démarrer le scan manuellement</span>
            </button>
          )}

          {/* Error Message */}
          {cameraError && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex gap-2 text-xs">
              <AlertCircle size={17} className="shrink-0 text-amber-600 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold block">{cameraError}</span>
                <span className="text-[11px] text-amber-700 block">
                  Astuce : Vous pouvez également pointer l'appareil photo ordinaire de votre smartphone sur le QR code physique.
                </span>
              </div>
            </div>
          )}

          {!cameraError && (
            <p className="text-xs text-slate-600 text-center">
              Pointez la caméra vers le QR code placé sur votre table. Le serveur validera son empreinte cryptographique avant d'ouvrir votre session.
            </p>
          )}

          {/* Security Banner */}
          <div className="flex items-center gap-2 text-[11px] text-slate-500 bg-slate-50 p-3 rounded-xl border border-slate-100">
            <RefreshCw size={14} className="shrink-0 text-slate-400" />
            <span>Aucun numéro de table ne peut être saisi manuellement pour prévenir toute usurpation.</span>
          </div>

          {/* Close button */}
          <button 
            onClick={() => { stopCamera(); onClose(); }} 
            className="w-full py-3 rounded-xl border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
