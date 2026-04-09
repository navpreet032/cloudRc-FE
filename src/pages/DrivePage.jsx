import { useEffect, useRef, useState } from "react";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client/dist/sockjs.js";
import { useAuthStore } from "../store/auth";
import { bookingsApi } from "../lib/api";

const WS_URL = import.meta.env.VITE_BASE_WS_URL;
const turnUsername = import.meta.env.VITE_TURN_USERNAME;
const turnPass = import.meta.env.VITE_TURN_PASS;
const CONTROL_INTERVAL_MS = 80;

// ── Sensitivity factor (0.0–1.0). Lower = less sensitive. ──────────────────
const JOYSTICK_SENSITIVITY = 0.6;

function formatTime(seconds) {
  if (seconds < 0) return "00:00";
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// ── 2-D top-down car with steerable front wheels ───────────────────────────
function CarTopDown({ steering }) {
  // steering is –1 … +1; map to wheel angle ±30 deg
  const wheelAngle = steering * 30;
  const cos = Math.cos((wheelAngle * Math.PI) / 180).toFixed(4);
  const sin = Math.sin((wheelAngle * Math.PI) / 180).toFixed(4);
  const transform = `matrix(${cos},${sin},${-sin},${cos},0,0)`;

  // Wheel rectangle helper: cx,cy = center of wheel in car-local coords
  const Wheel = ({ cx, cy, steer }) => {
    const w = 5, h = 12;
    return (
      <g transform={`translate(${cx},${cy})${steer ? ` rotate(${wheelAngle})` : ""}`}>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="1.5"
          fill="rgba(245,158,11,0.85)" />
      </g>
    );
  };

  return (
    <svg
      viewBox="0 0 44 72"
      width="44"
      height="72"
      style={{ display: "block", overflow: "visible" }}
    >
      {/* Car body */}
      <rect x="6" y="4" width="32" height="64" rx="7" fill="rgba(245,158,11,0.08)"
        stroke="rgba(245,158,11,0.35)" strokeWidth="1.2" />

      {/* Windscreen tint */}
      <rect x="10" y="10" width="24" height="14" rx="3"
        fill="rgba(245,158,11,0.12)" stroke="rgba(245,158,11,0.2)" strokeWidth="0.8" />

      {/* Rear window */}
      <rect x="10" y="50" width="24" height="10" rx="3"
        fill="rgba(245,158,11,0.08)" stroke="rgba(245,158,11,0.15)" strokeWidth="0.8" />

      {/* Direction arrow */}
      <polygon points="22,6 19,12 25,12" fill="rgba(245,158,11,0.5)" />

      {/* Rear wheels (fixed) */}
      <Wheel cx={6}  cy={54} steer={false} />
      <Wheel cx={38} cy={54} steer={false} />

      {/* Front wheels (steerable) */}
      <Wheel cx={6}  cy={18} steer={true} />
      <Wheel cx={38} cy={18} steer={true} />
    </svg>
  );
}

// ── Joystick ───────────────────────────────────────────────────────────────
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

    // Apply sensitivity factor – scale raw –1…1 values down
    const rawS = dx / MAX;
    const rawT = -dy / MAX;
    onChange(
      parseFloat((rawS * JOYSTICK_SENSITIVITY).toFixed(2)),
      parseFloat((rawT * JOYSTICK_SENSITIVITY).toFixed(2)),
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
    <div ref={zoneRef} className="joy-zone" onMouseDown={start} onTouchStart={start}>
      <svg className="joy-svg" viewBox="0 0 120 120">
        <line x1="60" y1="8" x2="60" y2="112" stroke="rgba(245,158,11,0.2)" strokeWidth="0.8" />
        <line x1="8" y1="60" x2="112" y2="60" stroke="rgba(245,158,11,0.2)" strokeWidth="0.8" />
        <circle cx="60" cy="60" r="28" fill="none" stroke="rgba(245,158,11,0.12)"
          strokeWidth="0.8" strokeDasharray="3 3" />
        <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(245,158,11,0.08)"
          strokeWidth="0.8" />
      </svg>
      <div ref={thumbRef} className="joy-thumb" style={{ left: RADIUS, top: RADIUS }} />
    </div>
  );
}

// ── CruiseControl ──────────────────────────────────────────────────────────
function CruiseControl({ cruiseThrottle, setCruiseThrottle, enabled, setEnabled }) {
  return (
    <div className="cruise-wrap">
      <div className="cruise-header">
        <span className="cruise-label mono">CRUISE</span>
        <button
          className={`cruise-toggle mono ${enabled ? "active" : ""}`}
          onClick={() => setEnabled((v) => !v)}
        >
          {enabled ? "ON" : "OFF"}
        </button>
      </div>
      <div className="cruise-slider-row">
        <input
          type="range"
          min="-100"
          max="100"
          step="1"
          value={Math.round(cruiseThrottle * 100)}
          onChange={(e) =>
            setCruiseThrottle(parseFloat((parseInt(e.target.value) / 100).toFixed(2)))
          }
          className="cruise-slider"
          disabled={!enabled}
        />
      </div>
      <div className={`cruise-val mono ${cruiseThrottle > 0 ? "green" : cruiseThrottle < 0 ? "red" : ""}`}>
        {enabled
          ? `${cruiseThrottle >= 0 ? "+" : ""}${cruiseThrottle.toFixed(2)}`
          : "—"}
      </div>
    </div>
  );
}

// ── DrivePage ──────────────────────────────────────────────────────────────
export default function DrivePage({ booking, onLeave }) {
  const pcRef = useRef(null);
  const iceQueueRef = useRef([]);
  const videoRef = useRef(null);
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
  const gamepadActiveRef = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [gamepadConnected, setGamepadConnected] = useState(false);

  // ── Cruise control state ──
  const [cruiseEnabled, setCruiseEnabled] = useState(false);
  const [cruiseThrottle, setCruiseThrottle] = useState(0);
  const cruiseRef = useRef({ enabled: false, value: 0 });

  useEffect(() => {
    cruiseRef.current = { enabled: cruiseEnabled, value: cruiseThrottle };
  }, [cruiseEnabled, cruiseThrottle]);

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

  // ── WebRTC setup ──────────────────────────────────────────────────────────
  function setupWebRTC(client, carId) {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

     const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
        urls: "stun:stun.relay.metered.ca:80",
      },
      {
        urls: "turn:standard.relay.metered.ca:80",
        username: turnUsername,
        credential: turnPass,
      },
      {
        urls: "turn:standard.relay.metered.ca:80?transport=tcp",
        username: turnUsername,
        credential: turnPass,
      },
      {
        urls: "turn:standard.relay.metered.ca:443",
        username: turnUsername,
        credential: turnPass,
      },
      {
        urls: "turns:standard.relay.metered.ca:443?transport=tcp",
        username: turnUsername,
        credential: turnPass,
      },
      ],
    });
    pcRef.current = pc;

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        setHasStream(false);
      }
    };

    pc.ontrack = (event) => {
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
          setHasStream(true);
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
      try {
        const offer = JSON.parse(msg.body);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        while (iceQueueRef.current.length > 0) {
          await pc.addIceCandidate(iceQueueRef.current.shift());
        }
        client.publish({
          destination: `/app/webrtc/answer/${carId}`,
          body: JSON.stringify(answer),
        });
      } catch (e) {
        console.error("[WebRTC] offer error:", e);
      }
    });

    client.subscribe(`/topic/webrtc/ice/browser/${carId}`, async (msg) => {
      try {
        const candidate = new RTCIceCandidate(JSON.parse(msg.body));
        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidate);
        } else {
          iceQueueRef.current.push(candidate);
        }
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
        pcRef.current.close();
        pcRef.current = null;
      }
    };
  }, [carId, token]);

  // ── Sync cmdRef – cruise overrides joystick/keyboard throttle when active ─
  useEffect(() => {
    const effectiveThrottle = cruiseEnabled ? cruiseThrottle : throttle;
    cmdRef.current = { t: effectiveThrottle, s: steering };
  }, [throttle, steering, cruiseEnabled, cruiseThrottle]);

  // ── Keyboard controls ─────────────────────────────────────────────────────
  useEffect(() => {
    const keys = {};

    function updateTarget() {
      let t = 0, s = 0;
      if (keys["ArrowUp"] || keys["w"] || keys["W"]) t = 1;
      if (keys["ArrowDown"] || keys["s"] || keys["S"]) t = -1;
      if (keys["ArrowLeft"] || keys["a"] || keys["A"]) s = -1;
      if (keys["ArrowRight"] || keys["d"] || keys["D"]) s = 1;
      keyTargetRef.current = { t, s };
    }

    const down = (e) => { keys[e.key] = true; updateTarget(); };
    const up = (e) => { keys[e.key] = false; updateTarget(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);

    const LERP_SPEED = 0.12;
    let currentT = 0, currentS = 0;

    lerpRef.current = setInterval(() => {
      if (joystickActiveRef.current) return;

      const { t, s } = keyTargetRef.current;
      currentT += (t - currentT) * LERP_SPEED;
      currentS += (s - currentS) * LERP_SPEED;
      if (Math.abs(currentT) < 0.01) currentT = 0;
      if (Math.abs(currentS) < 0.01) currentS = 0;

      // Apply sensitivity to keyboard too
      const smoothT = parseFloat((currentT * JOYSTICK_SENSITIVITY).toFixed(2));
      const smoothS = parseFloat((currentS * JOYSTICK_SENSITIVITY).toFixed(2));

      // If cruise is active, keyboard only controls steering
      if (cruiseRef.current.enabled) {
        setSteering(smoothS);
      } else {
        setThrottle(smoothT);
        setSteering(smoothS);
      }
    }, 16);

    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      clearInterval(lerpRef.current);
    };
  }, []);

  // ── Gamepad polling ───────────────────────────────────────────────────────
  useEffect(() => {
    const onConnect = (e) => {
      console.log("[Gamepad] connected:", e.gamepad.id);
      setGamepadConnected(true);
    };
    const onDisconnect = () => {
      setGamepadConnected(false);
      gamepadActiveRef.current = false;
    };
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);

    // Poll at ~60 fps. Writes directly into cmdRef so the existing
    // 80 ms STOMP publish interval picks it up with zero extra latency.
    const poll = setInterval(() => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp = null;
      for (let i = 0; i < pads.length; i++) {
        if (pads[i]) { gp = pads[i]; break; }
      }
      if (!gp) return;

      // Standard gamepad mapping (Xbox / DualShock in standard mode):
      //   axes[0] = left  stick X  → steering  (–1 left … +1 right)
      //   axes[3] = right stick Y  → throttle fallback (inverted)
      //   buttons[7].value = RT (0..1) → forward
      //   buttons[6].value = LT (0..1) → reverse
      const deadzone = 0.08;

      let rawS = gp.axes[0] ?? 0;
      if (Math.abs(rawS) < deadzone) rawS = 0;

      let rawT = 0;
      const rt = gp.buttons[7]?.value ?? 0;
      const lt = gp.buttons[6]?.value ?? 0;
      if (rt > deadzone || lt > deadzone) {
        rawT = rt - lt;                          // RT = forward, LT = reverse
      } else {
        const rstY = gp.axes[3] ?? 0;
        rawT = Math.abs(rstY) < deadzone ? 0 : -rstY;  // right stick Y, inverted
      }

      const s = parseFloat((rawS * JOYSTICK_SENSITIVITY).toFixed(2));
      const t = parseFloat((rawT * JOYSTICK_SENSITIVITY).toFixed(2));

      gamepadActiveRef.current = s !== 0 || t !== 0;

      // Gamepad takes priority unless touch joystick is active
      if (!joystickActiveRef.current) {
        setSteering(s);
        if (!cruiseRef.current.enabled) setThrottle(t);
        const effectiveT = cruiseRef.current.enabled ? cruiseRef.current.value : t;
        cmdRef.current = { t: effectiveT, s };
      }
    }, 16);

    return () => {
      clearInterval(poll);
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
    };
  }, []);

  function handleJoystick(s, t) {
    joystickActiveRef.current = s !== 0 || t !== 0;
    setSteering(s);
    // If cruise is active, joystick Y-axis doesn't override throttle
    if (!cruiseRef.current.enabled) {
      setThrottle(t);
    }
    // Update cmdRef immediately for low-latency response
    const effectiveT = cruiseRef.current.enabled ? cruiseRef.current.value : t;
    cmdRef.current = { t: effectiveT, s };
  }

  const timeWarning = remaining < 300;
  const connected = wsStatus === "connected";
  const displayThrottle = cruiseEnabled ? cruiseThrottle : throttle;

  return (
    <div className="drive-root">
      {carError && <div className="car-error-banner mono">⚠ {carError}</div>}

      <div className="drive-view">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="stream-video"
          style={{ display: hasStream ? "block" : "none" }}
        />

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
                  <span className={`ss-val mono ${battery < 20 ? "red" : "green"}`}>
                    {battery}%
                  </span>
                </div>
              )}
              <div className="stream-stat">
                <span className="ss-label mono">STEERING</span>
                <span className="ss-val mono amber">
                  {steering >= 0 ? "+" : ""}{steering.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="no-stream-msg mono">WAITING FOR CAMERA STREAM</div>
          </div>
        )}
      </div>

      {/* HUD overlay */}
      <div className="drive-hud">

        {/* Left panel: throttle display + cruise control */}
        <div className="hud-left">
          <div className="throttle-display">
            <div className={`throttle-val mono ${displayThrottle > 0 ? "green" : displayThrottle < 0 ? "red" : ""}`}>
              {displayThrottle >= 0 ? "+" : ""}{displayThrottle.toFixed(2)}
            </div>
            <div className="throttle-label mono">
              {cruiseEnabled ? "CRUISE THROTTLE" : "THROTTLE INPUT"}
            </div>
          </div>

          <CruiseControl
            cruiseThrottle={cruiseThrottle}
            setCruiseThrottle={setCruiseThrottle}
            enabled={cruiseEnabled}
            setEnabled={setCruiseEnabled}
          />
        </div>

        {/* Center: leave button + gamepad indicator */}
        <div className="hud-center-controls">
          <div className={`gamepad-indicator mono ${gamepadConnected ? "active" : ""}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="4"/>
              <path d="M7 12h4M9 10v4"/>
              <circle cx="16" cy="11" r="1" fill="currentColor" stroke="none"/>
              <circle cx="18" cy="13" r="1" fill="currentColor" stroke="none"/>
            </svg>
            {gamepadConnected ? "GAMEPAD CONNECTED" : "NO GAMEPAD"}
          </div>
          <button className="leave-btn mono" onClick={handleLeave} disabled={leaving}>
            {leaving ? "LEAVING..." : "LEAVE"}
          </button>
        </div>

        {/* Right panel: car top-down + joystick */}
        <div className="hud-right">
          {/* 2D car view */}
          <div className="car-topdown-wrap">
            <div className="car-topdown-label mono">WHEEL ANGLE</div>
            <CarTopDown steering={steering} />
            <div className="car-topdown-val mono amber">
              {(steering * 30).toFixed(0)}°
            </div>
          </div>

          {/* Joystick */}
          <div className="joy-wrap">
            <div className="joy-label mono">THROTTLE · STEERING</div>
            <Joystick onChange={handleJoystick} />
          </div>
        </div>
      </div>

      <style>{`
        .drive-root { width: 100vw; height: 100vh; background: var(--bg-0); display: flex; flex-direction: column; overflow: hidden; position: relative; }

        /* ── Main view ── */
        .drive-view { flex: 1; position: relative; overflow: hidden; }
        .stream-video { width: 100%; height: 100%; object-fit: cover; position: absolute; inset: 0; }

        .stream-placeholder { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 40px; }

        .car-error-banner { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); z-index: 100; background: rgba(239,68,68,0.12); border: 1px solid var(--red); color: var(--red); font-size: 0.7rem; letter-spacing: 0.12em; padding: 8px 20px; border-radius: var(--radius); white-space: nowrap; animation: fadeUp 0.2s ease; }

        .stream-stats { display: flex; gap: 32px; flex-wrap: wrap; justify-content: center; }
        .stream-stat { display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .ss-label { font-size: 0.6rem; letter-spacing: 0.18em; color: var(--text-muted); }
        .ss-val { font-size: 1.1rem; color: var(--text-primary); }
        .ss-val.green { color: var(--green); }
        .ss-val.red   { color: var(--red); }
        .ss-val.amber { color: var(--amber); }
        .no-stream-msg { font-size: 0.65rem; letter-spacing: 0.2em; color: var(--text-muted); }

        /* ── HUD bar ── */
        .drive-hud { display: flex; align-items: flex-end; justify-content: space-between; padding: 16px 24px 24px; background: linear-gradient(transparent, rgba(9,11,14,0.95)); position: absolute; bottom: 0; left: 0; right: 0; pointer-events: none; gap: 12px; }
        .drive-hud > * { pointer-events: all; }

        /* ── Left panel ── */
        .hud-left { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; min-width: 140px; }

        /* ── Throttle display ── */
        .throttle-display { background: rgba(9,11,14,0.85); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 18px; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; width: 100%; box-sizing: border-box; }
        .throttle-val { font-size: 2rem; line-height: 1; color: var(--text-primary); transition: color 0.1s; }
        .throttle-val.green { color: var(--green); }
        .throttle-val.red   { color: var(--red); }
        .throttle-label { font-size: 0.55rem; letter-spacing: 0.18em; color: var(--text-muted); }

        /* ── Cruise control ── */
        .cruise-wrap { background: rgba(9,11,14,0.85); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box; }
        .cruise-header { display: flex; align-items: center; justify-content: space-between; }
        .cruise-label { font-size: 0.6rem; letter-spacing: 0.18em; color: var(--text-muted); }
        .cruise-toggle { background: transparent; border: 1px solid var(--border); color: var(--text-muted); font-size: 0.6rem; letter-spacing: 0.15em; padding: 3px 10px; border-radius: 3px; cursor: pointer; transition: all 0.15s; }
        .cruise-toggle.active { border-color: var(--amber); color: var(--amber); background: rgba(245,158,11,0.08); }
        .cruise-toggle:hover { border-color: var(--border-bright); color: var(--text-primary); }
        .cruise-slider-row { display: flex; align-items: center; gap: 6px; }
        .cruise-slider { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 2px; background: var(--bg-3); outline: none; cursor: pointer; transition: opacity 0.2s; }
        .cruise-slider:disabled { opacity: 0.3; cursor: default; }
        .cruise-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 16px; height: 16px; border-radius: 50%; background: var(--amber); box-shadow: 0 0 6px var(--amber-glow); cursor: pointer; }
        .cruise-slider::-moz-range-thumb { width: 16px; height: 16px; border-radius: 50%; background: var(--amber); box-shadow: 0 0 6px var(--amber-glow); cursor: pointer; border: none; }
        .cruise-val { font-size: 1rem; letter-spacing: 0.05em; color: var(--text-muted); }
        .cruise-val.green { color: var(--green); }
        .cruise-val.red { color: var(--red); }

        /* ── Center controls ── */
        .hud-center-controls { display: flex; flex-direction: column; align-items: center; gap: 8px; padding-bottom: 4px; }
        .gamepad-indicator { display: flex; align-items: center; gap: 6px; font-size: 0.6rem; letter-spacing: 0.12em; color: var(--text-muted); background: rgba(9,11,14,0.85); border: 1px solid var(--border); border-radius: var(--radius); padding: 5px 12px; transition: all 0.2s; }
        .gamepad-indicator.active { color: var(--green); border-color: var(--green); background: rgba(34,197,94,0.08); }
        .leave-btn { background: rgba(9,11,14,0.85); border: 1px solid var(--border); color: var(--text-secondary); font-size: 0.7rem; letter-spacing: 0.15em; padding: 8px 20px; cursor: pointer; border-radius: var(--radius); transition: all var(--transition); }
        .leave-btn:hover { border-color: var(--red); color: var(--red); }

        /* ── Right panel ── */
        .hud-right { display: flex; flex-direction: row; align-items: flex-end; gap: 16px; }

        /* ── Car top-down ── */
        .car-topdown-wrap { display: flex; flex-direction: column; align-items: center; gap: 5px; background: rgba(9,11,14,0.85); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 14px; }
        .car-topdown-label { font-size: 0.55rem; letter-spacing: 0.15em; color: var(--text-muted); }
        .car-topdown-val { font-size: 0.75rem; letter-spacing: 0.1em; }

        /* ── Joystick ── */
        .joy-wrap { display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .joy-label { font-size: 0.55rem; letter-spacing: 0.15em; color: var(--text-muted); }
        .joy-zone { position: relative; width: 120px; height: 120px; border-radius: 50%; background: rgba(9,11,14,0.85); border: 1.5px solid var(--border-bright); cursor: pointer; touch-action: none; user-select: none; }
        .joy-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
        .joy-thumb { position: absolute; width: 34px; height: 34px; border-radius: 50%; background: var(--amber); transform: translate(-50%, -50%); pointer-events: none; box-shadow: 0 0 10px var(--amber-glow); }

        .amber { color: var(--amber); }
        .green { color: var(--green); }
        .red   { color: var(--red); }
      `}</style>
    </div>
  );
}