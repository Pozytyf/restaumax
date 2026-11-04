import React, { useEffect, useRef, useState } from 'react';
import { Camera, X, AlertCircle, QrCode, RefreshCw, CheckCircle2 } from 'lucide-react';
import { sounds } from '../../utils/audio';

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanResult: (targetPath: string) => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({ isOpen, onClose, onScanResult }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const scanningRef = useRef(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState(false);

  const stopCamera = () => {
    scanningRef.current = false;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }
    let cancelled = false;
    const start = async () => {
      setCameraError(null);
      setFeedback(false);
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("La caméra n'est pas disponible sur cet appareil. Vous pouvez scanner le QR avec l'appareil photo natif du téléphone.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraReady(true);
        const Detector = (window as any).BarcodeDetector;
        if (!Detector) {
          setCameraError("Ce navigateur ne prend pas en charge la lecture QR intégrée. Utilisez l'appareil photo natif du téléphone pour ouvrir le QR physique.");
          return;
        }
        const detector = new Detector({ formats: ['qr_code'] });
        scanningRef.current = true;
        const scan = async () => {
          if (!scanningRef.current || !videoRef.current) return;
          if (videoRef.current.readyState >= 2) {
            try {
              const codes = await detector.detect(videoRef.current);
              const value = codes?.[0]?.rawValue;
              if (value) {
                let parsed: URL;
                try { parsed = new URL(value, window.location.origin); }
                catch { throw new Error('QR code illisible.'); }
                const tokenMatch = parsed.pathname.match(/^\/q\/([A-Za-z0-9_-]{40,100})\/?$/);
                if (parsed.origin !== window.location.origin || !tokenMatch || parsed.search || parsed.hash) {
                  throw new Error("Ce QR code n'est pas un QR de table RestauMax valide pour ce domaine.");
                }
                scanningRef.current = false;
                setFeedback(true);
                sounds.playSuccess();
                stopCamera();
                onScanResult(parsed.pathname);
                onClose();
                return;
              }
            } catch (error: any) {
              if (error instanceof Error && error.message !== 'QR code illisible.') {
                setCameraError(error.message);
              }
            }
          }
          if (scanningRef.current) frameRef.current = requestAnimationFrame(scan);
        };
        frameRef.current = requestAnimationFrame(scan);
      } catch (error: any) {
        const name = error?.name || '';
        setCameraError(name === 'NotAllowedError'
          ? "L'accès à la caméra a été refusé. Autorisez la caméra ou utilisez l'appareil photo natif du téléphone."
          : name === 'NotFoundError'
            ? "Aucune caméra n'a été détectée sur cet appareil."
            : "Impossible d'activer la caméra. Réessayez ou utilisez l'appareil photo natif du téléphone.");
      }
    };
    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200">
        <div className="px-5 py-4 bg-[#101d2d] text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ff6500]/20 text-[#ff6500] flex items-center justify-center"><QrCode size={20} /></div>
            <div>
              <h2 className="text-base font-black">Scanner le QR physique</h2>
              <p className="text-[11px] text-slate-300">Scannez uniquement le code placé sur votre table</p>
            </div>
          </div>
          <button onClick={() => { stopCamera(); onClose(); }} className="p-2 rounded-xl hover:bg-white/10" aria-label="Fermer"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="relative aspect-[4/3] bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center">
            <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
            {!cameraReady && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white"><Camera size={34} /><span className="text-xs font-semibold">Activation de la caméra…</span></div>}
            {cameraReady && !feedback && <div className="absolute inset-8 border-2 border-emerald-400 rounded-2xl pointer-events-none"><div className="absolute -top-1 left-1/2 -translate-x-1/2 w-16 h-1 bg-emerald-400 rounded-full" /></div>}
            {feedback && <div className="absolute inset-0 bg-emerald-950/80 flex flex-col items-center justify-center text-white gap-2"><CheckCircle2 size={40} /><span className="font-bold">QR détecté</span></div>}
          </div>
          {cameraError && <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex gap-2 text-xs"><AlertCircle size={17} className="shrink-0" /><span>{cameraError}</span></div>}
          {!cameraError && <p className="text-xs text-slate-600 text-center">Placez le QR code dans le cadre. Le serveur vérifiera son authenticité et l'état de la table avant d'ouvrir la session.</p>}
          <div className="flex items-center gap-2 text-[11px] text-slate-500 bg-slate-50 p-3 rounded-xl"><RefreshCw size={14} /><span>Aucun numéro de table ne peut être saisi ou sélectionné manuellement.</span></div>
          <button onClick={() => { stopCamera(); onClose(); }} className="w-full py-3 rounded-xl border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50">Fermer</button>
        </div>
      </div>
    </div>
  );
};
