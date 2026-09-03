import React, { useRef, useEffect } from "react";

export default function AudioEqualizer({ isTranscribing, numBars = 30 }) {
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const barsRef = useRef([]);

  useEffect(() => {
    let cancelled = false;

    async function startAudio() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser);
        analyserRef.current = analyser;

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        const bars = barsRef.current;

        function animate() {
          if (cancelled) return;
          analyser.getByteFrequencyData(freqData);
          const center = Math.floor(numBars / 2);
          for (let i = 0; i < numBars; i++) {
            const bar = bars[i];
            if (!bar) continue;
            const dist = Math.abs(i - center);
            const freqIdx = Math.min(freqData.length - 1, Math.floor(dist * 1.5));
            const raw = freqData[freqIdx] / 255;
            const baseHeight = Math.max(4, 22 - dist * 1.2);
            const height = Math.max(3, baseHeight * (0.3 + raw * 1.8));
            bar.style.height = `${height}px`;
            bar.style.opacity = String(0.4 + raw * 0.6);
          }
          rafRef.current = requestAnimationFrame(animate);
        }
        animate();
      } catch (err) {
        console.warn("AudioEqualizer: mic access failed", err);
      }
    }

    function stopAudio() {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
      analyserRef.current = null;
    }

    if (!isTranscribing) {
      startAudio();
    } else {
      stopAudio();
    }

    return () => {
      cancelled = true;
      stopAudio();
    };
  }, [isTranscribing, numBars]);

  const bars = Array.from({ length: numBars }, (_, i) => i);
  const center = Math.floor(numBars / 2);

  return (
    <div className={`nox-equalizer nox-equalizer-enter ${isTranscribing ? "is-transcribing" : ""}`}>
      {bars.map((i) => {
        const dist = Math.abs(i - center);
        const height = Math.max(6, 22 - dist * 1.5);
        const delay = (dist * 0.06).toFixed(2);
        const duration = isTranscribing
          ? (0.9 + dist * 0.04).toFixed(2)
          : "0.1s";
        return (
          <div
            key={i}
            ref={(el) => { barsRef.current[i] = el; }}
            className="nox-equalizer-bar"
            style={{
              height: `${height}px`,
              "--eq-height": `${height}px`,
              "--eq-delay": `${delay}s`,
              "--eq-duration": `${duration}s`,
            }}
          />
        );
      })}
    </div>
  );
}
