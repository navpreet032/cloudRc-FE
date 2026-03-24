import { useEffect, useRef, useState } from "react";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client/dist/sockjs.js";
import { useAuthStore } from "../store/auth";
const WS_URL = import.meta.env.VITE_BASE_WS_URL
const CONTROL_INTERVAL_MS = 80;

function formatTime(seconds) {
  if (seconds < 0) return "00:00";
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function Joystick({ onChange }) {
  const zoneRef = useRef(null);
  const thumbRef = useRef(null);
  const isDragging = useRef(false);
  const RADIUS = 60;
  const MAX = 44;

  function getXY(e) {
    const rect = zoneRef.current.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    let dx = cx - (rect.left + RADIUS);
    let dy = cy - (rect.top + RADIUS);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > MAX) {
      dx = (dx / dist) * MAX;
      dy = (dy / dist) * MAX;
    }
    return { dx, dy };
  }

  function applyPosition(dx, dy) {
    if (!thumbRef.current) return;
    thumbRef.current.style.left = RADIUS + dx + "px";
    thumbRef.current.style.top = RADIUS + dy + "px";
    onChange(
      parseFloat((dx / MAX).toFixed(2)),
      parseFloat((-dy / MAX).toFixed(2)),
    );
  }

  function start(e) {
    e.preventDefault();
    isDragging.current = true;
    thumbRef.current.style.transition = "none";
    const { dx, dy } = getXY(e);
    applyPosition(dx, dy);
  }

  function move(e) {
    if (!isDragging.current) return;
    e.preventDefault();
    const { dx, dy } = getXY(e);
    applyPosition(dx, dy);
  }

  function release() {
    if (!isDragging.current) return;
    isDragging.current = false;
    thumbRef.current.style.transition = "left 0.12s ease, top 0.12s ease";
    thumbRef.current.style.left = RADIUS + "px";
    thumbRef.current.style.top = RADIUS + "px";
    onChange(0, 0);
  }

  useEffect(() => {
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("mouseup", release);
    window.addEventListener("touchend", release);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("mouseup", release);
      window.removeEventListener("touchend", release);
    };
  }, []);

  return (
    <div
      ref={zoneRef}
      className="joy-zone"
      onMouseDown={start}
      onTouchStart={start}
    >
      <svg className="joy-svg" viewBox="0 0 120 120">
        <line
          x1="60"
          y1="8"
          x2="60"
          y2="112"
          stroke="rgba(245,158,11,0.2)"
          strokeWidth="0.8"
        />
        <line
          x1="8"
          y1="60"
          x2="112"
          y2="60"
          stroke="rgba(245,158,11,0.2)"
          strokeWidth="0.8"
        />
        <circle
          cx="60"
          cy="60"
          r="28"
          fill="none"
          stroke="rgba(245,158,11,0.12)"
          strokeWidth="0.8"
          strokeDasharray="3 3"
        />
        <circle
          cx="60"
          cy="60"
          r="50"
          fill="none"
          stroke="rgba(245,158,11,0.08)"
          strokeWidth="0.8"
        />
      </svg>
      <div
        ref={thumbRef}
        className="joy-thumb"
        style={{ left: RADIUS, top: RADIUS }}
      />
    </div>
  );
}

export default function DrivePage({ booking, onLeave }) {
  const pcRef = useRef(null); // RTCPeerConnection
  const videoRef = useRef(null); // <video> element
  const [hasStream, setHasStream] = useState(false);

  const [carError, setCarError] = useState(null);
  const token = useAuthStore((s) => s.token);
  const [wsStatus, setWsStatus] = useState("connecting");
  const [throttle, setThrottle] = useState(0);
  const [steering, setSteering] = useState(0);
  const [remaining, setRemaining] = useState(1800);
  const [battery, setBattery] = useState(booking?.car?.batteryPct ?? null);
  const cmdRef = useRef({ t: 0, s: 0 });
  const intervalRef = useRef(null);
  const errorTimerRef = useRef(null);
  const endTime = booking?.endTime ? new Date(booking.endTime) : null;
  const carId = booking?.car?.id;
  const keyTargetRef = useRef({ t: 0, s: 0 });
  const lerpRef = useRef(null);
  const joystickActiveRef = useRef(false); 
  const [leaving, setLeaving] = useState(false);

  async function handleLeave() {
    setLeaving(true);
    try {
      await bookingsApi.cancel(booking.id);
    } catch (e) {
      // already expired/cancelled — ignore
    }
    onLeave();
  }

  useEffect(() => {
    const id = setInterval(() => {
      if (!endTime) return;
      setRemaining(Math.max(0, Math.floor((endTime - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [endTime]);

  // ── WebRTC setup ──────────────────────────────────────────
  function setupWebRTC(client, carId) {
    // Fix 4: close previous PC before creating new one
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    pc.onconnectionstatechange = () => {
      console.log("[WebRTC] connection state:", pc.connectionState);
      if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed"
      ) {
        setHasStream(false);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("[WebRTC] ICE state:", pc.iceConnectionState);
    };

    pc.ontrack = (event) => {
      console.log("[WebRTC] ontrack fired", event.streams);
      // Fix 3: use a small timeout to ensure videoRef is mounted
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
          setHasStream(true);
          console.log("[WebRTC] stream attached to video");
        } else {
          console.error("[WebRTC] videoRef still null after timeout");
        }
      }, 0);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && client.connected) {
        client.publish({
          destination: `/app/webrtc/ice/android/${carId}`,
          body: JSON.stringify(event.candidate),
        });
      }
    };

    client.subscribe(`/topic/webrtc/offer/${carId}`, async (msg) => {
      console.log("[WebRTC] offer received");
      try {
        const offer = JSON.parse(msg.body);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        client.publish({
          destination: `/app/webrtc/answer/${carId}`,
          body: JSON.stringify(answer),
        });
        console.log("[WebRTC] answer sent");
      } catch (e) {
        console.error("[WebRTC] offer error:", e);
      }
    });

    client.subscribe(`/topic/webrtc/ice/browser/${carId}`, async (msg) => {
      try {
        const candidate = JSON.parse(msg.body);
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("[WebRTC] ICE candidate added");
      } catch (e) {
        console.error("[WebRTC] ICE error:", e);
      }
    });
  }

  useEffect(() => {
    if (!carId || !token) return;
    const client = new Client({
      webSocketFactory: () => new SockJS(WS_URL),
      connectHeaders: { Authorization: `Bearer ${token}` },
      reconnectDelay: 3000,
      onConnect: () => {
        setWsStatus("connected");

        client.subscribe("/user/queue/errors", (msg) => {
          setCarError(msg.body);

          // clear previous timer before setting new one
          if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
          errorTimerRef.current = setTimeout(() => {
            setCarError(null);
            errorTimerRef.current = null;
          }, 3000);
        });

        client.subscribe("/user/queue/session", (msg) => {
          try {
            const e = JSON.parse(msg.body);
            if (e.type === "EXPIRED") onLeave();
          } catch {}
        });

        client.subscribe(`/topic/car/${carId}/status`, (msg) => {
          try {
            const d = JSON.parse(msg.body);
            if (d.batteryPct !== undefined) setBattery(d.batteryPct);
          } catch {}
        });

        setupWebRTC(client, carId);
      },
      onDisconnect: () => setWsStatus("disconnected"),
      onStompError: () => setWsStatus("error"),
    });
    client.activate();

    intervalRef.current = setInterval(() => {
      if (client.connected) {
        client.publish({
          destination: `/app/car/${carId}/control`,
          body: JSON.stringify(cmdRef.current),
        });
      }
    }, CONTROL_INTERVAL_MS);

    return () => {
      clearInterval(intervalRef.current);

      client.deactivate();

      if (pcRef.current) {
        pcRef.current.close(); // ← cleanup
        pcRef.current = null;
      }
    };
  }, [carId, token]);

  useEffect(() => {
    cmdRef.current = { t: throttle, s: steering };
  }, [throttle, steering]);

  // Keyboard controls
 useEffect(() => {
  const keys = {};

  function updateTarget() {
    let t = 0, s = 0;
    if (keys['ArrowUp']   || keys['w'] || keys['W']) t =  1;
    if (keys['ArrowDown'] || keys['s'] || keys['S']) t = -1;
    if (keys['ArrowLeft'] || keys['a'] || keys['A']) s = -1;
    if (keys['ArrowRight']|| keys['d'] || keys['D']) s =  1;
    keyTargetRef.current = { t, s };
  }

  const down = (e) => { keys[e.key] = true;  updateTarget(); };
  const up   = (e) => { keys[e.key] = false; updateTarget(); };
  window.addEventListener('keydown', down);
  window.addEventListener('keyup',   up);

  const LERP_SPEED = 0.12;
  let currentT = 0, currentS = 0;

  lerpRef.current = setInterval(() => {
    // skip if joystick is being used
    if (joystickActiveRef.current) return;

    const { t, s } = keyTargetRef.current;
    currentT += (t - currentT) * LERP_SPEED;
    currentS += (s - currentS) * LERP_SPEED;
    if (Math.abs(currentT) < 0.01) currentT = 0;
    if (Math.abs(currentS) < 0.01) currentS = 0;

    const smoothT = parseFloat(currentT.toFixed(2));
    const smoothS = parseFloat(currentS.toFixed(2));

    setThrottle(smoothT);
    setSteering(smoothS);
  }, 16);

  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup',   up);
    clearInterval(lerpRef.current);
  };
}, []);

  function handleJoystick(s, t) {
    joystickActiveRef.current = (s !== 0 || t !== 0)
    setSteering(s);
    setThrottle(t);
    cmdRef.current = { t, s };
  }

  const timeWarning = remaining < 300;
  const connected = wsStatus === "connected";

  return (
    <div className="drive-root">
      {carError && <div className="car-error-banner mono">⚠ {carError}</div>}

      <div className="drive-view">
        {/* Fix 1+2: always mounted, playsInline for mobile */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="stream-video"
          style={{ display: hasStream ? "block" : "none" }}
        />

        {/* stats shown only when no stream */}
        {!hasStream && (
          <div className="stream-placeholder">
            <div className="stream-stats">
              <div className="stream-stat">
                <span className="ss-label mono">STATUS</span>
                <span className={`ss-val mono ${connected ? "green" : "red"}`}>
                  {wsStatus.toUpperCase()}
                </span>
              </div>
              <div className="stream-stat">
                <span className="ss-label mono">CAR</span>
                <span className="ss-val mono">#{carId}</span>
              </div>
              <div className="stream-stat">
                <span className="ss-label mono">SESSION</span>
                <span className={`ss-val mono ${timeWarning ? "red" : ""}`}>
                  {formatTime(remaining)}
                </span>
              </div>
              {battery !== null && (
                <div className="stream-stat">
                  <span className="ss-label mono">BATTERY</span>
                  <span
                    className={`ss-val mono ${battery < 20 ? "red" : "green"}`}
                  >
                    {battery}%
                  </span>
                </div>
              )}
              <div className="stream-stat">
                <span className="ss-label mono">STEERING</span>
                <span className="ss-val mono amber">
                  {steering >= 0 ? "+" : ""}
                  {steering.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="no-stream-msg mono">WAITING FOR CAMERA STREAM</div>
          </div>
        )}
      </div>

      {/* HUD overlay */}
      <div className="drive-hud">
        <div className="throttle-display">
          <div
            className={`throttle-val mono ${throttle > 0 ? "green" : throttle < 0 ? "red" : ""}`}
          >
            {throttle >= 0 ? "+" : ""}
            {throttle.toFixed(2)}
          </div>
          <div className="throttle-label mono">THROTTLE INPUT</div>
        </div>

        <div className="hud-center-controls">
          <button
            className="leave-btn mono"
            onClick={handleLeave}
            disabled={leaving}
          >
            {leaving ? "LEAVING..." : "LEAVE"}
          </button>
        </div>

        <div className="joy-wrap">
          <div className="joy-label mono">THROTTLE · STEERING</div>
          <Joystick onChange={handleJoystick} />
        </div>
      </div>

      <style>{`
        .drive-root {
          width: 100vw;
          height: 100vh;
          background: var(--bg-0);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          position: relative;
        }

        /* ── Main view ── */
        .drive-view {
          flex: 1;
          position: relative;
          overflow: hidden;
        }

        .stream-video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          position: absolute;
          inset: 0;
            }

        .stream-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 40px;
        }
          .car-error-banner {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  background: rgba(239,68,68,0.12);
  border: 1px solid var(--red);
  color: var(--red);
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  padding: 8px 20px;
  border-radius: var(--radius);
  white-space: nowrap;
  animation: fadeUp 0.2s ease;
}

        /* When you add WebRTC, do: */
        /* video.stream-video { width:100%; height:100%; object-fit:cover; position:absolute; inset:0; } */

        .stream-stats {
          display: flex;
          gap: 32px;
          flex-wrap: wrap;
          justify-content: center;
        }

        .stream-stat {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }

        .ss-label {
          font-size: 0.6rem;
          letter-spacing: 0.18em;
          color: var(--text-muted);
        }

        .ss-val {
          font-size: 1.1rem;
          color: var(--text-primary);
        }

        .ss-val.green { color: var(--green); }
        .ss-val.red   { color: var(--red); }
        .ss-val.amber { color: var(--amber); }

        .no-stream-msg {
          font-size: 0.65rem;
          letter-spacing: 0.2em;
          color: var(--text-muted);
        }

        /* ── HUD bar ── */
        .drive-hud {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          padding: 16px 24px 24px;
          background: linear-gradient(transparent, rgba(9,11,14,0.95));
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          pointer-events: none;
        }

        .drive-hud > * {
          pointer-events: all;
        }

        /* ── Throttle display ── */
        .throttle-display {
          background: rgba(9,11,14,0.85);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 10px 18px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          min-width: 120px;
        }

        .throttle-val {
          font-size: 2rem;
          line-height: 1;
          color: var(--text-primary);
          transition: color 0.1s;
        }

        .throttle-val.green { color: var(--green); }
        .throttle-val.red   { color: var(--red); }

        .throttle-label {
          font-size: 0.55rem;
          letter-spacing: 0.18em;
          color: var(--text-muted);
        }

        /* ── Center controls ── */
        .hud-center-controls {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding-bottom: 4px;
        }

        .leave-btn {
          background: rgba(9,11,14,0.85);
          border: 1px solid var(--border);
          color: var(--text-secondary);
          font-size: 0.7rem;
          letter-spacing: 0.15em;
          padding: 8px 20px;
          cursor: pointer;
          border-radius: var(--radius);
          transition: all var(--transition);
        }

        .leave-btn:hover {
          border-color: var(--red);
          color: var(--red);
        }

        /* ── Joystick ── */
        .joy-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }

        .joy-label {
          font-size: 0.55rem;
          letter-spacing: 0.15em;
          color: var(--text-muted);
        }

        .joy-zone {
          position: relative;
          width: 120px;
          height: 120px;
          border-radius: 50%;
          background: rgba(9,11,14,0.85);
          border: 1.5px solid var(--border-bright);
          cursor: pointer;
          touch-action: none;
          user-select: none;
        }

        .joy-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
        }

        .joy-thumb {
          position: absolute;
          width: 34px;
          height: 34px;
          border-radius: 50%;
          background: var(--amber);
          transform: translate(-50%, -50%);
          pointer-events: none;
          box-shadow: 0 0 10px var(--amber-glow);
        }
      `}</style>
    </div>
  );
}
