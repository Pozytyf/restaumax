import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, 
  X, 
  AlertCircle, 
  QrCode, 
  RefreshCw, 
  MapPin, 
  ArrowRight,
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import { sounds } from '../../utils/audio';
import { parseAndValidateQrInput } from '../../utils/pricing';

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanResult: (targetPath: string) => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  onClose,
  onScanResult,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualTableInput, setManualTableInput] = useState<string>('');
  const [scannedFeedback, setScannedFeedback] = useState<string | null>(null);

  // Available quick demo tables for easy testing
  const DEMO_TABLES = ['1', '2', '3', '4', '5', '6', 'Bar', 'Terrasse A'];

  // Start Camera Stream
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    startCamera();

    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    setCameraError(null);
    setHasCameraPermission(null);
    setScannedFeedback(null);

    // Check mediaDevices support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("La caméra n'est pas prise en charge sur ce navigateur ou environnement.");
      setHasCameraPermission(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setHasCameraPermission(true);

      // Start scanning loop if BarcodeDetector is available
      startBarcodeDetection();
    } catch (err: any) {
      console.warn("Impossible d'accéder à la caméra:", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError("L'accès à la caméra a été refusé. Vous pouvez choisir ou saisir votre numéro de table ci-dessous.");
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError("Aucune caméra détectée sur cet appareil. Utilisez la sélection manuelle ci-dessous.");
      } else {
        setCameraError("Impossible d'activer la caméra. Utilisez la sélection manuelle de table ci-dessous.");
      }
      setHasCameraPermission(false);
    }
  };

  const stopCamera = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Continuous Barcode Detection loop using BarcodeDetector API if available
  const startBarcodeDetection = () => {
    // Check if BarcodeDetector is supported in window
    const BarcodeDetectorClass = (window as any).BarcodeDetector;
    if (!BarcodeDetectorClass) {
      return;
    }

    let detector: any;
    try {
      detector = new BarcodeDetectorClass({ formats: ['qr_code'] });
    } catch {
      return;
    }

    const checkFrame = async () => {
      if (videoRef.current && videoRef.current.readyState >= 2) {
        try {
          const barcodes = await detector.detect(videoRef.current);
          if (barcodes && barcodes.length > 0) {
            const rawValue = barcodes[0].rawValue;
            if (rawValue) {
              handleDetectedUrl(rawValue);
              return;
            }
          }
        } catch {
          // Detection frame error is benign
        }
      }
      animationFrameRef.current = requestAnimationFrame(checkFrame);
    };

    animationFrameRef.current = requestAnimationFrame(checkFrame);
  };

  const handleDetectedUrl = (scannedString: string) => {
    stopCamera();
    sounds.playTap();

    const parsed = parseAndValidateQrInput(scannedString, 'chez-awa');

    if (!parsed.isValid) {
      setCameraError(parsed.error || "Ce QR code ne correspond pas à un menu de table RestauMax.");
      sounds.playAlert();
      return;
    }

    setScannedFeedback(parsed.tableNumber ? `Table ${parsed.tableNumber}` : 'Menu à emporter');

    setTimeout(() => {
      onScanResult(parsed.canonicalPath);
      onClose();
    }, 600);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTable = manualTableInput.trim();
    if (!cleanTable) return;

    sounds.playTap();
    const parsed = parseAndValidateQrInput(cleanTable, 'chez-awa');
    if (parsed.isValid) {
      onScanResult(parsed.canonicalPath);
      onClose();
    } else {
      setCameraError(parsed.error || "Numéro de table non valide.");
      sounds.playAlert();
    }
  };

  const handleSelectDemoTable = (tbl: string) => {
    sounds.playTap();
    const parsed = parseAndValidateQrInput(tbl, 'chez-awa');
    onScanResult(parsed.canonicalPath);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-scanner-title"
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#101d2d] text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ff6500]/20 text-[#ff6500] flex items-center justify-center font-bold">
              <QrCode size={20} />
            </div>
            <div>
              <h2 id="qr-scanner-title" className="text-base font-black tracking-tight text-white flex items-center gap-1.5">
                <span>Scanner le QR Code de Table</span>
              </h2>
              <p className="text-[11px] text-slate-300">
                Pointez la caméra vers le chevalet posé sur votre table
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              sounds.playTap();
              onClose();
            }}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Fermer le scanner"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Camera Viewfinder Area */}
          <div className="relative w-full aspect-square max-h-64 sm:max-h-72 rounded-2xl overflow-hidden bg-slate-950 flex items-center justify-center border border-slate-800">
            {hasCameraPermission === true ? (
              <>
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                
                {/* Viewfinder Target Overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-8">
                  <div className="w-48 h-48 border-2 border-[#ff6500] rounded-2xl relative shadow-lg">
                    {/* Viewfinder corner brackets */}
                    <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-white rounded-tl-lg" />
                    <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-white rounded-tr-lg" />
                    <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-white rounded-bl-lg" />
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-white rounded-br-lg" />

                    {/* Laser Scan line effect */}
                    <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-[#ff6500] to-transparent animate-pulse absolute top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                {scannedFeedback && (
                  <div className="absolute inset-0 bg-emerald-900/90 text-white flex flex-col items-center justify-center p-4 text-center animate-in fade-in">
                    <CheckCircle2 size={44} className="text-emerald-400 mb-2" />
                    <p className="font-black text-sm">QR Code Détecté !</p>
                    <p className="text-xs text-emerald-200 mt-1 truncate max-w-xs">{scannedFeedback}</p>
                    <p className="text-[11px] text-emerald-300 mt-2">Chargement du menu de votre table...</p>
                  </div>
                )}
              </>
            ) : hasCameraPermission === false ? (
              <div className="p-6 text-center text-slate-300 space-y-3">
                <Camera size={36} className="mx-auto text-slate-500" />
                <p className="text-xs font-bold text-slate-200">{cameraError}</p>
                <button
                  type="button"
                  onClick={startCamera}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 transition-colors inline-flex items-center gap-1.5"
                >
                  <RefreshCw size={13} />
                  <span>Réessayer la caméra</span>
                </button>
              </div>
            ) : (
              <div className="p-6 text-center text-slate-400 space-y-2">
                <Camera size={36} className="mx-auto text-slate-600 animate-pulse" />
                <p className="text-xs font-medium">Activation de la caméra...</p>
              </div>
            )}
          </div>

          {/* Quick Select Table Selector (Ideal for testing or when camera is off) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1">
                <MapPin size={12} className="text-[#ff6500]" />
                <span>Sélection rapide par numéro de table :</span>
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {DEMO_TABLES.map((tbl) => (
                <button
                  key={tbl}
                  type="button"
                  onClick={() => handleSelectDemoTable(tbl)}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-[#ff6500] hover:text-white text-slate-800 text-xs font-bold transition-all border border-slate-200/80 active:scale-95"
                >
                  Table {tbl}
                </button>
              ))}
            </div>
          </div>

          {/* Manual Input Fallback */}
          <form onSubmit={handleManualSubmit} className="pt-2 border-t border-slate-100 space-y-2">
            <label className="block text-[11px] font-bold text-slate-600">
              Ou saisissez manuellement le numéro de table :
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualTableInput}
                onChange={(e) => setManualTableInput(e.target.value)}
                placeholder="ex. 4, 12, VIP..."
                className="flex-1 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#ff6500] focus:bg-white"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-[#ff6500] hover:bg-[#e05800] text-white rounded-xl text-xs font-black transition-all flex items-center gap-1 active:scale-95 shadow-xs"
              >
                <span>Accéder</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </form>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
          <span>Chez Awa — Menu QR interactif</span>
          <button
            type="button"
            onClick={() => {
              sounds.playTap();
              onScanResult('/r/chez-awa');
              onClose();
            }}
            className="font-bold text-[#ff6500] hover:underline"
          >
            Commander à emporter sans table →
          </button>
        </div>
      </div>
    </div>
  );
};
