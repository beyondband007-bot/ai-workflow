import { useEffect, useRef, useState } from 'react';
import wikiLogo1 from './logo1.png';

const API_BASE = process.env.REACT_APP_API_BASE || '';
const PORTAL_BASE =
  process.env.REACT_APP_PORTAL_BASE || '/portal/index.html';
const TOKEN_KEY = 'auth_demo_token';

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || 'Request failed');
  }
  return data;
}

function redirectToPortal(token) {
  const target = new URL(PORTAL_BASE, window.location.origin);
  target.searchParams.set('token', token);
  window.location.href = target.toString();
}

function IndexFxBackground() {
  const canvasRef = useRef(null);
  const pointerRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const pointer = pointerRef.current;
    const ctx = canvas?.getContext?.('2d');
    let rafId;
    let width = 0;
    let height = 0;
    const pointerPos = { x: -9999, y: -9999 };
    const particles = [];
    const isMobile = window.matchMedia('(max-width: 760px)').matches;

    if (!canvas || !ctx) {
      return undefined;
    }

    const random = (min, max) => Math.random() * (max - min) + min;

    const resize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    const buildParticles = () => {
      particles.length = 0;
      const count = isMobile ? 38 : 72;
      for (let i = 0; i < count; i += 1) {
        particles.push({
          x: random(0, width),
          y: random(0, height),
          vx: random(-0.24, 0.24),
          vy: random(-0.22, 0.22),
          r: random(0.8, 2.4),
          a: random(0.18, 0.75),
        });
      }
    };

    const drawLinks = () => {
      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        for (let j = i + 1; j < particles.length; j += 2) {
          const q = particles[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 105) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.strokeStyle = `rgba(74, 228, 198, ${0.12 * (1 - dist / 105)})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
    };

    const tick = () => {
      ctx.clearRect(0, 0, width, height);

      const glow = ctx.createRadialGradient(
        pointerPos.x,
        pointerPos.y,
        0,
        pointerPos.x,
        pointerPos.y,
        160,
      );
      glow.addColorStop(0, 'rgba(54, 244, 199, 0.16)');
      glow.addColorStop(1, 'rgba(54, 244, 199, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;
        if (p.y < -10) p.y = height + 10;
        if (p.y > height + 10) p.y = -10;

        const dx = pointerPos.x - p.x;
        const dy = pointerPos.y - p.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 120) {
          p.x -= dx * 0.0018;
          p.y -= dy * 0.0018;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(54, 244, 199, ${p.a})`;
        ctx.fill();
      }

      drawLinks();
      rafId = requestAnimationFrame(tick);
    };

    const handleMouseMove = (event) => {
      pointerPos.x = event.clientX;
      pointerPos.y = event.clientY;
      if (pointer) {
        pointer.style.opacity = '1';
        pointer.style.transform = `translate(${event.clientX - 170}px, ${event.clientY - 170}px)`;
      }
    };

    const handleTouchMove = (event) => {
      if (!event.touches[0]) {
        return;
      }
      pointerPos.x = event.touches[0].clientX;
      pointerPos.y = event.touches[0].clientY;
    };

    const handleMouseLeave = () => {
      if (pointer) {
        pointer.style.opacity = '0';
      }
    };

    const handleResize = () => {
      cancelAnimationFrame(rafId);
      resize();
      buildParticles();
      tick();
    };

    resize();
    buildParticles();
    tick();

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="fx-canvas" />
      <div ref={pointerRef} className="pointer-glow" />
    </>
  );
}

function EyeIcon({ open }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {open ? (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      )}
    </svg>
  );
}

export default function LoginPage() {
  const initialMode =
    new URLSearchParams(window.location.search).get('mode') === 'register'
      ? 'register'
      : 'login';

  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({
    identifier: '',
    email: '',
    username: '',
    password: '',
  });
  const [focused, setFocused] = useState(null);
  const [showPwd, setShowPwd] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  const [, setCurrentUser] = useState(null);
  const [ripple, setRipple] = useState(null);
  const [hoverForgot, setHoverForgot] = useState(false);
  const btnRef = useRef(null);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const fetchCurrentUser = async (
    token = window.localStorage.getItem(TOKEN_KEY),
  ) => {
    if (!token) {
      setCurrentUser(null);
      return;
    }

    try {
      const me = await requestJson('/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      setCurrentUser(me);
      setStatus('ok');
      setMessage('已登录' + me.username + ' (' + me.email + ')');
    } catch (error) {
      window.localStorage.removeItem(TOKEN_KEY);
      setCurrentUser(null);
      setStatus('err');
      setMessage(error.message);
    }
  };

  useEffect(() => {
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (!token) {
      return;
    }

    fetchCurrentUser(token);
  }, []);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (loading) {
      return;
    }

    setLoading(true);
    setStatus(null);

    try {
      if (mode === 'login') {
        const result = await requestJson('/login', {
          method: 'POST',
          body: JSON.stringify({
            identifier: form.identifier.trim(),
            password: form.password,
          }),
        });

        window.localStorage.setItem(TOKEN_KEY, result.access_token);
        await fetchCurrentUser(result.access_token);
        redirectToPortal(result.access_token);
      } else {
        const result = await requestJson('/register', {
          method: 'POST',
          body: JSON.stringify({
            email: form.email.trim(),
            username: form.username.trim(),
            password: form.password,
          }),
        });

        setStatus('ok');
        setMessage('注册成功：' + result.username + ', 请登录。');
        setMode('login');
        setForm({
          identifier: result.email,
          email: result.email,
          username: result.username,
          password: '',
        });
        setCurrentUser(null);
      }
    } catch (error) {
      setStatus('err');
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBtnDown = (event) => {
    setPressing(true);
    const rect = btnRef.current.getBoundingClientRect();
    const x =
      (event.touches ? event.touches[0].clientX : event.clientX) - rect.left;
    const y =
      (event.touches ? event.touches[0].clientY : event.clientY) - rect.top;
    setRipple({ x, y, key: Date.now() });
    setTimeout(() => setPressing(false), 160);
  };

  const CYAN = '#36f4c7';
  const LINE = 'rgba(74, 228, 198, 0.2)';
  const PANEL = 'rgba(10, 18, 30, 0.92)';

  const S = {
    page: {
      position: 'relative',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      background:
        'radial-gradient(circle at top left, rgba(54, 244, 199, 0.14), transparent 30%), radial-gradient(circle at 80% 10%, rgba(39, 207, 255, 0.2), transparent 26%), linear-gradient(180deg, #060a10 0%, #0a121d 44%, #04080f 100%)',
      fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
      padding: '24px',
    },
    grid: {
      position: 'absolute',
      inset: 0,
      backgroundImage:
        'linear-gradient(rgba(62, 129, 168, 0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(62, 129, 168, 0.14) 1px, transparent 1px)',
      backgroundSize: '44px 44px',
      maskImage:
        'radial-gradient(circle at center, rgba(255,255,255,0.9), transparent 80%)',
      pointerEvents: 'none',
      zIndex: 0,
      opacity: 0.55,
    },
    glowTop: {
      position: 'fixed',
      top: -140,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 1000,
      height: 340,
      borderRadius: '50%',
      background:
        'radial-gradient(circle, rgba(86, 243, 255, 0.19) 0%, rgba(86, 243, 255, 0.07) 46%, transparent 76%)',
      filter: 'blur(56px)',
      pointerEvents: 'none',
      zIndex: 0,
    },
    shell: {
      position: 'relative',
      zIndex: 2,
      width: 'min(1400px, 100%)',
      gap: 120,
      display: 'grid',
      gridTemplateColumns: '1.2fr 0.88fr',
      overflow: 'hidden',
    },
    left: {
      padding: '36px 34px 30px',
      display: 'flex',
      alignItems: 'center',
    },
    leftBadge: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      borderRadius: 999,
      border: '1px solid ' + LINE,
      background: 'rgba(255, 255, 255, 0.92)',
      color: 'rgba(134, 169, 173, 0.95)',
      padding: '8px 14px',
      fontSize: 12,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      marginBottom: 10,
    },
    leftLogoImg: {
      width: 120,
    },
    leftTitle: {
      margin: 0,
      color: '#e6f7f3',
      fontSize: 'clamp(30px, 4vw, 48px)',
      lineHeight: 1.06,
      letterSpacing: 0.5,
      textShadow: '0 0 26px rgba(97, 240, 232, 0.16)',
    },
    leftSub: {
      marginTop: 16,
      marginBottom: 24,
      color: 'rgba(134, 169, 173, 0.9)',
      fontSize: 15,
      lineHeight: 1.75,
      maxWidth: 600,
    },
    leftCards: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: 14,
      marginBottom: 22,
    },
    leftCard: {
      padding: '16px 14px',
      borderRadius: 16,
      border: '1px solid ' + LINE,
      background: 'rgba(8, 22, 34, 0.72)',
      boxShadow: 'inset 0 0 0 1px rgba(208, 252, 255, 0.03)',
    },
    leftCardLabel: {
      fontSize: 12,
      color: 'rgba(134, 169, 173, 0.9)',
      marginTop: 8,
      letterSpacing: '0.05em',
    },
    leftCardValue: {
      fontSize: 20,
      fontWeight: 800,
      color: '#e6f7f3',
      lineHeight: 1,
    },
    leftWorkflow: {
      marginTop: 14,
      borderRadius: 20,
      border: '1px solid ' + LINE,
      background:
        'linear-gradient(140deg, rgba(12, 24, 36, 0.84), rgba(8, 22, 34, 0.72))',
      padding: '22px 20px',
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: 12,
    },
    workflowItem: {
      borderRadius: 14,
      padding: '14px 12px',
      border: '1px solid rgba(74, 228, 198, 0.18)',
      background: 'rgba(2, 11, 23, 0.5)',
    },
    workflowTitle: {
      color: '#e6f7f3',
      fontWeight: 700,
      marginBottom: 6,
      fontSize: 14,
    },
    workflowDesc: {
      color: 'rgba(134, 169, 173, 0.86)',
      fontSize: 12,
      lineHeight: 1.5,
    },
    right: {
      padding: '26px 24px',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
    },
    card: {
      position: 'relative',
      width: '100%',
      maxWidth: 460,
      padding: '28px 24px 24px',
      background: PANEL,
      borderRadius: 22,
      border: '1px solid ' + LINE,
    },
    cardHalo: {
      position: 'absolute',
      inset: -1,
      borderRadius: 22,
      pointerEvents: 'none',
      background:
        'linear-gradient(180deg, rgba(54, 244, 199, 0.14), rgba(39,207,255,0.06) 44%, rgba(0,0,0,0) 100%)',
      maskImage:
        'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
      padding: 1,
      WebkitMask:
        'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
      WebkitMaskComposite: 'xor',
      maskComposite: 'exclude',
    },
    logoWrap: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16,
    },
    logoBadge: {
      width: 56,
      height: 56,
      borderRadius: 16,
      background:
        'linear-gradient(180deg, rgba(86, 243, 255, 0.98), rgba(48, 199, 238, 0.92))',
      boxShadow:
        '0 12px 30px rgba(54, 244, 199, 0.24), inset 0 1px 0 rgba(255,255,255,0.42)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    logoImage: {
      width: 42,
      height: 42,
      objectFit: 'contain',
    },
    logoTextMain: {
      fontSize: 20,
      fontWeight: 800,
      letterSpacing: 0.4,
      color: '#e6f7f3',
      marginBottom: 2,
    },
    logoTextSub: {
      fontSize: 12,
      color: 'rgba(134, 169, 173, 0.88)',
      fontWeight: 600,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
    },
    introTag: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
      padding: '7px 11px',
      borderRadius: 999,
      border: '1px solid rgba(112, 242, 255, 0.24)',
      background: 'rgba(6, 20, 39, 0.72)',
      color: 'rgba(134, 169, 173, 0.92)',
      fontSize: 11,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
    },
    h1: {
      color: '#e6f7f3',
      fontSize: 'clamp(22px, 3.2vw, 28px)',
      fontWeight: 800,
      margin: '0 0 8px',
      textShadow: '0 0 18px rgba(97, 240, 232, 0.1)',
    },
    sub: {
      color: 'rgba(134, 169, 173, 0.88)',
      fontSize: 14,
      lineHeight: 1.7,
      margin: '0 0 18px',
    },
    modeSwitch: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 8,
      marginBottom: 30,
      padding: 4,
      background: 'rgba(255,255,255,0.03)',
      borderRadius: 14,
      border: '1px solid ' + LINE,
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)',
    },
    modeBtn: (active) => ({
      border: '1px solid transparent',
      borderRadius: 10,
      padding: '10px 12px',
      cursor: 'pointer',
      fontWeight: 700,
      fontSize: 14,
      color: active ? '#031020' : 'rgba(230, 247, 243, 0.86)',
      background: active
        ? 'linear-gradient(135deg, #36f4c7 0%, #86e8ff 100%)'
        : 'rgba(255,255,255,0.02)',
      boxShadow: active ? '0 0 20px rgba(54, 244, 199, 0.28)' : 'none',
      transition: 'all .2s ease',
    }),
    label: {
      display: 'block',
      color: 'rgba(230, 247, 243, 0.92)',
      fontSize: 13,
      fontWeight: 600,
      marginBottom: 8,
      letterSpacing: '0.03em',
    },
    fieldWrap: {
      position: 'relative',
      marginBottom: 14,
    },
    input: (name) => ({
      width: '100%',
      boxSizing: 'border-box',
      background: 'rgba(9, 24, 41, 0.9)',
      border: `1.5px solid ${
        focused === name ? 'rgba(74, 228, 198, 0.55)' : LINE
      }`,
      borderRadius: 12,
      padding: '12px 14px',
      paddingRight: name === 'password' ? 46 : 14,
      color: '#e6f7f3',
      caretColor: CYAN,
      fontSize: 15,
      outline: 'none',
      transition: 'border-color .25s, box-shadow .25s, background .25s',
      boxShadow:
        focused === name
          ? '0 0 0 3px rgba(74, 228, 198, 0.14), 0 0 16px rgba(74, 228, 198, 0.12)'
          : 'none',
    }),
    eyeBtn: {
      position: 'absolute',
      right: 12,
      bottom: 10,
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: 'rgba(134, 169, 173, 0.8)',
      padding: 4,
      display: 'flex',
      transition: 'color .2s',
    },
    submitBtn: {
      position: 'relative',
      overflow: 'hidden',
      width: '100%',
      padding: '13px 0',
      marginTop: 30,
      borderRadius: 999,
      border: '1px solid rgba(122, 244, 238, 0.3)',
      background: loading
        ? 'rgba(23, 85, 110, 0.55)'
        : 'linear-gradient(135deg, #36f4c7 0%, #86e8ff 100%)',
      color: loading ? 'rgba(230,247,243,0.9)' : '#031020',
      fontSize: 15,
      fontWeight: 800,
      cursor: loading ? 'wait' : 'pointer',
      transform: pressing ? 'scale(0.974)' : 'scale(1)',
      transitionProperty: 'transform, box-shadow, filter',
      transitionDuration: pressing ? '0.08s' : '0.22s',
      boxShadow: pressing
        ? '0 4px 14px rgba(54, 244, 199, 0.26)'
        : '0 0 24px rgba(54, 244, 199, 0.28), inset 0 1px 0 rgba(255,255,255,0.5)',
      filter: pressing ? 'brightness(0.95)' : 'brightness(1)',
      userSelect: 'none',
      letterSpacing: 1,
    },
    forgotWrap: {
      textAlign: 'center',
      marginTop: 16,
    },
    forgotLink: {
      position: 'relative',
      display: 'inline-block',
      color: hoverForgot ? CYAN : 'rgba(134, 169, 173, 0.92)',
      fontSize: 13,
      cursor: 'pointer',
      textDecoration: 'none',
      transition: 'color .2s',
    },
    underline: {
      position: 'absolute',
      bottom: -2,
      left: 0,
      height: 1.5,
      borderRadius: 2,
      background: 'linear-gradient(90deg, #27cfff, #36f4c7)',
      width: hoverForgot ? '100%' : '0%',
      transition: 'width 0.3s cubic-bezier(.4,0,.2,1)',
    },
    sessionCard: {
      marginTop: 14,
      padding: '12px 14px',
      borderRadius: 12,
      background: 'rgba(8, 21, 36, 0.92)',
      border: '1px solid ' + LINE,
      color: '#e6f7f3',
      fontSize: 14,
      lineHeight: 1.7,
      boxShadow:
        'inset 0 0 0 1px rgba(255,255,255,0.02), 0 0 20px rgba(2, 8, 14, 0.58)',
    },
    sessionTitle: {
      fontSize: 12,
      color: 'rgba(134, 169, 173, 0.9)',
      marginBottom: 6,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
    },
    logoutBtn: {
      marginTop: 10,
      background: 'rgba(255,255,255,0.02)',
      color: '#e6f7f3',
      border: '1px solid ' + LINE,
      borderRadius: 999,
      padding: '8px 14px',
      cursor: 'pointer',
      fontWeight: 700,
    },
    alert: (ok) => ({
      marginTop: 14,
      padding: '10px 12px',
      borderRadius: 12,
      fontSize: 13,
      lineHeight: 1.7,
      background: ok ? 'rgba(16,185,129,0.11)' : 'rgba(239,68,68,0.12)',
      border: `1px solid ${
        ok ? 'rgba(103, 241, 201, 0.18)' : 'rgba(255, 130, 146, 0.16)'
      }`,
      color: ok ? '#8bf76a' : '#ff9ead',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }),
    spinner: {
      width: 18,
      height: 18,
      border: '2.5px solid rgba(8,18,37,0.22)',
      borderTop: '2.5px solid rgba(8,18,37,0.78)',
      borderRadius: '50%',
      display: 'inline-block',
      marginRight: 10,
      animation: 'spin .75s linear infinite',
    },
  };

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes ripple {
          0% { transform: scale(0); opacity: 0.55; }
          100% { transform: scale(4); opacity: 0; }
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(16px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes drift {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(46px, 46px, 0); }
        }
        @keyframes gridWarp {
          0%, 100% { transform: perspective(900px) rotateX(0deg) scale(1); }
          50% { transform: perspective(900px) rotateX(4deg) scale(1.04); }
        }
        @keyframes beamMove {
          0% { transform: translateX(-40%) translateY(0); }
          50% { transform: translateX(0%) translateY(-3%); }
          100% { transform: translateX(40%) translateY(0); }
        }
        @keyframes noiseShift {
          0% { transform: translate(0, 0); }
          50% { transform: translate(-1px, 1px); }
          100% { transform: translate(1px, -1px); }
        }
        @keyframes fxSpin {
          to { transform: rotate(1turn); }
        }

        * { -webkit-tap-highlight-color: transparent; }

        .login-input {
          background: rgba(9, 24, 41, 0.9) !important;
          color: #e6f7f3 !important;
          caret-color: #36f4c7;
        }

        .login-input:hover,
        .login-input:focus,
        .login-input:active,
        .login-input:not(:placeholder-shown) {
          background: rgba(9, 24, 41, 0.95) !important;
          color: #e6f7f3 !important;
        }

        input::placeholder {
          color: rgba(134, 169, 173, 0.7);
        }

        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus,
        input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 1000px rgba(9, 24, 41, 0.95) inset !important;
          -webkit-text-fill-color: #e6f7f3 !important;
          caret-color: #36f4c7;
          transition: background-color 5000s ease-in-out 0s;
        }

        .lp-shell {
          animation: cardIn .5s ease both;
        }
        .fx-grid {
          position: fixed;
          inset: 0;
          z-index: 0;
          background-image:
            linear-gradient(rgba(70, 92, 170, 0.15) 1px, transparent 1px),
            linear-gradient(90deg, rgba(70, 92, 170, 0.15) 1px, transparent 1px);
          background-size: 40px 40px;
          mask-image: radial-gradient(circle at center, rgba(0, 0, 0, 0.9), transparent 85%);
          opacity: 0.5;
          transform-origin: center;
          animation: drift 22s linear infinite, gridWarp 10s ease-in-out infinite;
          pointer-events: none;
        }
        .fx-noise {
          position: fixed;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          background-image: radial-gradient(rgba(255, 255, 255, 0.08) 0.6px, transparent 0.6px);
          background-size: 3px 3px;
          opacity: 0.06;
          animation: noiseShift 0.28s steps(2) infinite;
        }
        .fx-beam {
          position: fixed;
          inset: -20% -40%;
          z-index: 1;
          pointer-events: none;
          background: linear-gradient(112deg, transparent 42%, rgba(54, 244, 199, 0.2) 50%, transparent 58%);
          transform: translateX(-35%);
          animation: beamMove 5.2s ease-in-out infinite;
        }
        .fx-rings {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
        }
        .fx-rings::before,
        .fx-rings::after {
          content: "";
          position: absolute;
          width: 60vmax;
          height: 60vmax;
          border-radius: 50%;
          border: 1px solid rgba(74, 228, 198, 0.18);
          filter: blur(0.5px);
        }
        .fx-rings::before {
          top: -18vmax;
          right: -18vmax;
          animation: fxSpin 20s linear infinite;
          box-shadow: inset 0 0 140px rgba(54, 244, 199, 0.12);
        }
        .fx-rings::after {
          bottom: -24vmax;
          left: -20vmax;
          animation: fxSpin 30s linear infinite reverse;
          box-shadow: inset 0 0 140px rgba(74, 228, 198, 0.12);
        }
        .fx-canvas {
          position: fixed;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: 2;
          pointer-events: none;
        }
        .pointer-glow {
          position: fixed;
          width: 380px;
          height: 380px;
          left: 0;
          top: 0;
          z-index: 2;
          pointer-events: none;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          background: radial-gradient(circle, rgba(54, 244, 199, 0.24) 0%, rgba(54, 244, 199, 0.12) 18%, rgba(54, 244, 199, 0.03) 48%, rgba(54, 244, 199, 0) 74%);
          mix-blend-mode: screen;
          filter: blur(4px);
          opacity: 0;
          transition: opacity 0.25s ease;
        }

        @media (max-width: 1080px) {
          .lp-shell {
            grid-template-columns: 1fr !important;
          }

          .lp-left {
            border-right: none !important;
            border-bottom: 1px solid rgba(74, 228, 198, 0.2);
          }
        }

        @media (max-width: 760px) {
          .lp-left-cards {
            grid-template-columns: 1fr !important;
          }

          .lp-workflow {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>

      <div style={S.page}>
        <div className="fx-grid" />
        <div className="fx-rings" />
        <div className="fx-beam" />
        <div className="fx-noise" />
        <div style={S.glowTop} />
        <IndexFxBackground />

        <div className="lp-shell" style={S.shell}>
          <section className="lp-left" style={S.left}>
            <div>
              <div style={S.leftBadge}>
                <img src={wikiLogo1} alt="logo1" style={S.leftLogoImg} />
              </div>
              <h1 style={S.leftTitle}>
                鲸创传媒集团
                <br />
                <small>
                  智能工作流平台积分系统客户端
                </small>
              </h1>
              <p style={S.leftSub}>
                助力企业降本增效。深度整合资源，优化运营流程，以创新管理模式全方位助力企业降低运营成本；同时通过技术赋能提升效率，实现企业可持续的降本增效与高质量发展。
              </p>
              <div className="lp-left-cards" style={S.leftCards}>
                <div style={S.leftCard}>
                  <div style={S.leftCardValue}>
                    整合
                  </div>
                  <div style={S.leftCardLabel}>
                    融合资源 协同运作
                  </div>
                </div>
                <div style={S.leftCard}>
                  <div style={S.leftCardValue}>
                    创新
                  </div>
                  <div style={S.leftCardLabel}>
                    变革模式 优化管理
                  </div>
                </div>
                <div style={S.leftCard}>
                  <div style={S.leftCardValue}>
                    赋能
                  </div>
                  <div style={S.leftCardLabel}>
                    注入技术 提升效率
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section style={S.right}>
            <div style={S.card}>
              <div style={S.cardHalo} />

              <h2 style={S.h1}>
                {mode === 'login' ? '欢迎回来' : '创建账户'}
              </h2>
              <p style={S.sub}>
                {mode === 'login'
                  ? '请输入账户信息登录系统，登录成功后将自动跳转到个人积分工作台。'
                  : '创建新账户后将初始化 100 积分，并可直接进入工作流系统。'}
              </p>

              <div style={S.modeSwitch}>
                <button
                  type="button"
                  style={S.modeBtn(mode === 'login')}
                  onClick={() => setMode('login')}
                >
                  登录
                </button>
                <button
                  type="button"
                  style={S.modeBtn(mode === 'register')}
                  onClick={() => setMode('register')}
                >
                  注册
                </button>
              </div>
              <form onSubmit={handleSubmit} noValidate>
                {mode === 'login' ? (
                  <div style={S.fieldWrap}>
                    <label style={S.label} htmlFor="identifier">
                      用户名 / 邮箱
                    </label>
                    <input
                      className="login-input"
                      id="identifier"
                      name="identifier"
                      type="text"
                      placeholder="请输入用户名或邮箱"
                      value={form.identifier}
                      onChange={handleChange}
                      onFocus={() => setFocused('identifier')}
                      onBlur={() => setFocused(null)}
                      style={S.input('identifier')}
                      autoComplete="username"
                    />
                  </div>
                ) : (
                  <>
                    <div style={S.fieldWrap}>
                      <label style={S.label} htmlFor="email">
                        邮箱
                      </label>
                      <input
                        className="login-input"
                        id="email"
                        name="email"
                        type="email"
                        placeholder="请输入邮箱"
                        value={form.email}
                        onChange={handleChange}
                        onFocus={() => setFocused('email')}
                        onBlur={() => setFocused(null)}
                        style={S.input('email')}
                        autoComplete="email"
                      />
                    </div>
                    <div style={S.fieldWrap}>
                      <label style={S.label} htmlFor="username">
                        用户名
                      </label>
                      <input
                        className="login-input"
                        id="username"
                        name="username"
                        type="text"
                        placeholder="请输入用户名"
                        value={form.username}
                        onChange={handleChange}
                        onFocus={() => setFocused('username')}
                        onBlur={() => setFocused(null)}
                        style={S.input('username')}
                        autoComplete="username"
                      />
                    </div>
                  </>
                )}
                <div style={S.fieldWrap}>
                  <label style={S.label} htmlFor="password">
                    密码
                  </label>
                  <input
                    className="login-input"
                    id="password"
                    name="password"
                    type={showPwd ? 'text' : 'password'}
                    placeholder={mode === 'login' ? '请输入密码' : '请输入至少6个字符'}
                    value={form.password}
                    onChange={handleChange}
                    onFocus={() => setFocused('password')}
                    onBlur={() => setFocused(null)}
                    style={S.input('password')}
                    autoComplete={
                      mode === 'login' ? 'current-password' : 'new-password'
                    }
                  />
                  <button
                    type="button"
                    style={S.eyeBtn}
                    onClick={() => setShowPwd((value) => !value)}
                    aria-label={showPwd ? 'Hide password' : 'Show password'}
                  >
                    <EyeIcon open={showPwd} />
                  </button>
                </div>

                <button
                  ref={btnRef}
                  type="submit"
                  style={S.submitBtn}
                  disabled={loading}
                  onMouseDown={handleBtnDown}
                  onTouchStart={handleBtnDown}
                >
                  {ripple && (
                    <span
                      key={ripple.key}
                      style={{
                        position: 'absolute',
                        left: ripple.x,
                        top: ripple.y,
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: 'rgba(255,255,255,0.48)',
                        transform: 'translate(-50%,-50%) scale(0)',
                        animation: 'ripple 0.55s linear forwards',
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                  {loading ? (
                    <>
                      <span style={S.spinner} />
                      {mode === 'login' ? 'Logging in...' : 'Registering...'}
                    </>
                  ) : mode === 'login' ? (
                    '登录'
                  ) : (
                    '注册并创建账户'
                  )}
                </button>
              </form>

              {status === 'ok' && <div style={S.alert(true)}>{message}</div>}
              {status === 'err' && <div style={S.alert(false)}>{message}</div>}

              <div style={S.forgotWrap}>
                <a
                  href="#forgot"
                  style={S.forgotLink}
                  onMouseEnter={() => setHoverForgot(true)}
                  onMouseLeave={() => setHoverForgot(false)}
                  onFocus={() => setHoverForgot(true)}
                  onBlur={() => setHoverForgot(false)}
                  onClick={(event) => {
                    event.preventDefault();
                    alert('当前项目还没有重置密码接口，后续可以继续补上。');
                  }}
                >
                  忘记密码?
                  <span style={S.underline} />
                </a>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

