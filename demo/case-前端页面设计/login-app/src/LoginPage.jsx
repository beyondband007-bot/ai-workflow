import { useEffect, useRef, useState } from 'react';
import wikiLogo from './logo.png';

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
    throw new Error(data.detail || '请求失败');
  }
  return data;
}

function redirectToPortal(token) {
  const target = new URL(PORTAL_BASE, window.location.origin);
  target.searchParams.set('token', token);
  window.location.href = target.toString();
}

function GridBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext?.('2d');
    let frameId;

    if (!canvas || !ctx) {
      return undefined;
    }

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    const draw = (time) => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      for (let row = 0; row < 42; row += 1) {
        for (let col = 0; col < 120; col += 1) {
          const x = (col / 119) * width;
          const baseY = height * 0.68 + row * 8.2;
          const wave =
            Math.sin(col * 0.16 + time * 0.0012) * 16 +
            Math.cos(row * 0.32 + time * 0.0014) * 10 +
            Math.sin((row + col) * 0.06 + time * 0.0008) * 18;
          const depth = (row / 42) ** 1.8;
          const y = baseY + wave * (0.25 + depth);
          const size = 0.55 + depth * 1.6;
          const alpha = 0.05 + depth * 0.28;

          ctx.beginPath();
          ctx.fillStyle = `rgba(60, 196, 255, ${alpha})`;
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      frameId = requestAnimationFrame(draw);
    };

    resize();
    draw(0);
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 30,
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
      }}
    />
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
  const [currentUser, setCurrentUser] = useState(null);
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
      setMessage(`已登录：${me.username}（${me.email}）`);
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
        setMessage(`注册成功：${result.username}，请直接登录。`);
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

  const CYAN = '#61f0e8';
  const LINE = 'rgba(56, 192, 228, 0.26)';
  const PANEL = 'rgba(5, 16, 36, 0.84)';

  const S = {
    page: {
      position: 'relative',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      background:
        'radial-gradient(circle at 12% 18%, rgba(35, 140, 170, 0.22), transparent 34%), radial-gradient(circle at 88% 24%, rgba(42, 108, 175, 0.2), transparent 34%), linear-gradient(128deg, #020914 0%, #030f22 52%, #020815 100%)',
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
      border: `1px solid ${LINE}`,
      background: 'rgba(7, 25, 46, 0.8)',
      color: 'rgba(172, 218, 230, 0.84)',
      padding: '8px 14px',
      fontSize: 12,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      marginBottom: 20,
    },
    leftTitle: {
      margin: 0,
      color: '#def6fb',
      fontSize: 'clamp(30px, 4vw, 48px)',
      lineHeight: 1.06,
      letterSpacing: 0.5,
      textShadow: '0 0 26px rgba(97, 240, 232, 0.16)',
    },
    leftSub: {
      marginTop: 16,
      marginBottom: 24,
      color: 'rgba(165, 198, 217, 0.78)',
      fontSize: 15,
      lineHeight: 1.75,
      maxWidth: 580,
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
      border: `1px solid ${LINE}`,
      background: 'rgba(6, 22, 44, 0.72)',
      boxShadow: 'inset 0 0 0 1px rgba(208, 252, 255, 0.03)',
    },
    leftCardLabel: {
      fontSize: 12,
      color: 'rgba(146, 186, 207, 0.84)',
      marginTop: 8,
      letterSpacing: '0.05em',
    },
    leftCardValue: {
      fontSize: 20,
      fontWeight: 800,
      color: '#e0fbff',
      lineHeight: 1,
    },
    leftWorkflow: {
      marginTop: 14,
      borderRadius: 20,
      border: `1px solid ${LINE}`,
      background:
        'linear-gradient(140deg, rgba(10, 36, 62, 0.82), rgba(4, 14, 31, 0.66))',
      padding: '22px 20px',
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: 12,
    },
    workflowItem: {
      borderRadius: 14,
      padding: '14px 12px',
      border: '1px solid rgba(56, 192, 228, 0.18)',
      background: 'rgba(2, 11, 23, 0.5)',
    },
    workflowTitle: {
      color: '#e6faff',
      fontWeight: 700,
      marginBottom: 6,
      fontSize: 14,
    },
    workflowDesc: {
      color: 'rgba(146, 186, 207, 0.76)',
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
      border: `1px solid ${LINE}`,
    },
    cardHalo: {
      position: 'absolute',
      inset: -1,
      borderRadius: 22,
      pointerEvents: 'none',
      background:
        'linear-gradient(180deg, rgba(138, 251, 255, 0.14), rgba(18,47,89,0.04) 44%, rgba(0,0,0,0) 100%)',
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
        '0 12px 30px rgba(46, 243, 255, 0.24), inset 0 1px 0 rgba(255,255,255,0.42)',
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
      color: '#f0fdff',
      marginBottom: 2,
    },
    logoTextSub: {
      fontSize: 12,
      color: 'rgba(163, 203, 218, 0.8)',
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
      color: 'rgba(170, 238, 245, 0.86)',
      fontSize: 11,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
    },
    h1: {
      color: '#edfbff',
      fontSize: 'clamp(22px, 3.2vw, 28px)',
      fontWeight: 800,
      margin: '0 0 8px',
      textShadow: '0 0 18px rgba(97, 240, 232, 0.1)',
    },
    sub: {
      color: 'rgba(163, 203, 218, 0.78)',
      fontSize: 14,
      lineHeight: 1.7,
      margin: '0 0 18px',
    },
    modeSwitch: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 8,
      marginBottom: 18,
      padding: 4,
      background: 'rgba(255,255,255,0.03)',
      borderRadius: 14,
      border: `1px solid ${LINE}`,
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)',
    },
    modeBtn: (active) => ({
      border: '1px solid transparent',
      borderRadius: 10,
      padding: '10px 12px',
      cursor: 'pointer',
      fontWeight: 700,
      fontSize: 14,
      color: active ? '#03202b' : 'rgba(194, 227, 238, 0.82)',
      background: active
        ? 'linear-gradient(315deg, #7cf5eb 0%, #56d8f0 100%)'
        : 'rgba(255,255,255,0.02)',
      boxShadow: active ? '0 0 20px rgba(86, 216, 240, 0.28)' : 'none',
      transition: 'all .2s ease',
    }),
    label: {
      display: 'block',
      color: 'rgba(194, 227, 238, 0.92)',
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
      background: 'rgba(4, 15, 33, 0.96)',
      border: `1.5px solid ${
        focused === name ? 'rgba(124,245,235,0.56)' : LINE
      }`,
      borderRadius: 12,
      padding: '12px 14px',
      paddingRight: name === 'password' ? 46 : 14,
      color: '#ebfcff',
      caretColor: CYAN,
      fontSize: 15,
      outline: 'none',
      transition: 'border-color .25s, box-shadow .25s, background .25s',
      boxShadow:
        focused === name
          ? '0 0 0 3px rgba(86, 216, 240, 0.14), 0 0 16px rgba(86, 216, 240, 0.12)'
          : 'none',
    }),
    eyeBtn: {
      position: 'absolute',
      right: 12,
      bottom: 10,
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: 'rgba(163, 203, 218, 0.6)',
      padding: 4,
      display: 'flex',
      transition: 'color .2s',
    },
    submitBtn: {
      position: 'relative',
      overflow: 'hidden',
      width: '100%',
      padding: '13px 0',
      borderRadius: 999,
      border: '1px solid rgba(122, 244, 238, 0.3)',
      background: loading
        ? 'rgba(42, 134, 173, 0.42)'
        : 'linear-gradient(315deg, #7cf5eb 0%, #56d8f0 100%)',
      color: loading ? 'rgba(255,255,255,0.88)' : '#02222d',
      fontSize: 15,
      fontWeight: 800,
      cursor: loading ? 'wait' : 'pointer',
      transform: pressing ? 'scale(0.974)' : 'scale(1)',
      transitionProperty: 'transform, box-shadow, filter',
      transitionDuration: pressing ? '0.08s' : '0.22s',
      boxShadow: pressing
        ? '0 4px 14px rgba(86, 216, 240, 0.26)'
        : '0 0 24px rgba(86, 216, 240, 0.28), inset 0 1px 0 rgba(255,255,255,0.5)',
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
      color: hoverForgot ? CYAN : 'rgba(163, 203, 218, 0.62)',
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
      background: 'linear-gradient(90deg, #56d8f0, #7cf5eb)',
      width: hoverForgot ? '100%' : '0%',
      transition: 'width 0.3s cubic-bezier(.4,0,.2,1)',
    },
    sessionCard: {
      marginTop: 14,
      padding: '12px 14px',
      borderRadius: 12,
      background: 'rgba(3, 13, 30, 0.8)',
      border: `1px solid ${LINE}`,
      color: '#d8f8ff',
      fontSize: 14,
      lineHeight: 1.7,
      boxShadow:
        'inset 0 0 0 1px rgba(255,255,255,0.02), 0 0 20px rgba(20,98,120,0.14)',
    },
    sessionTitle: {
      fontSize: 12,
      color: 'rgba(163, 203, 218, 0.74)',
      marginBottom: 6,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
    },
    logoutBtn: {
      marginTop: 10,
      background: 'rgba(255,255,255,0.02)',
      color: '#bff4ff',
      border: `1px solid ${LINE}`,
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
      color: ok ? '#88efce' : '#ff9ead',
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

        * { -webkit-tap-highlight-color: transparent; }

        .login-input {
          background: rgba(4, 15, 33, 0.96) !important;
          color: #ebfcff !important;
          caret-color: #61f0e8;
        }

        .login-input:hover,
        .login-input:focus,
        .login-input:active,
        .login-input:not(:placeholder-shown) {
          background: rgba(4, 15, 33, 0.98) !important;
          color: #ebfcff !important;
        }

        input::placeholder {
          color: rgba(151, 197, 211, 0.34);
        }

        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus,
        input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 1000px rgba(4, 15, 33, 0.98) inset !important;
          -webkit-text-fill-color: #ebfcff !important;
          caret-color: #61f0e8;
          transition: background-color 5000s ease-in-out 0s;
        }

        .lp-shell {
          animation: cardIn .5s ease both;
        }

        @media (max-width: 1080px) {
          .lp-shell {
            grid-template-columns: 1fr !important;
          }

          .lp-left {
            border-right: none !important;
            border-bottom: 1px solid rgba(56, 192, 228, 0.26);
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
        <div style={S.grid} />
        <div style={S.glowTop} />
        <GridBackground />

        <div className="lp-shell" style={S.shell}>
          <section className="lp-left" style={S.left}>
            <div>
              <div style={S.leftBadge}>Workflow Console</div>
              <h1 style={S.leftTitle}>鲸创传媒集团<br /><small>积分系统客户端</small></h1>
              <p style={S.leftSub}>
                助力企业降本增效。深度整合资源，优化运营流程，以创新管理模式全方位助力企业降低运营成本；同时通过技术赋能提升效率，实现企业可持续的降本增效与高质量发展。
              </p>

              <div className="lp-left-cards" style={S.leftCards}>
                <div style={S.leftCard}>
                  <div style={S.leftCardValue}>整合</div>
                  <div style={S.leftCardLabel}>融合资源 协同运作</div>
                </div>
                <div style={S.leftCard}>
                  <div style={S.leftCardValue}>创新</div>
                  <div style={S.leftCardLabel}>变革模式 优化管理</div>
                </div>
                <div style={S.leftCard}>
                  <div style={S.leftCardValue}>赋能</div>
                  <div style={S.leftCardLabel}>注入技术 提升效率</div>
                </div>
              </div>

              <div className="lp-workflow" style={S.leftWorkflow}>
                <div style={S.workflowItem}>
                  <div style={S.workflowTitle}>工作流入口</div>
                  <div style={S.workflowDesc}>
                    先看账户，再进流程，最后统一在记录区追踪状态和积分变化。
                  </div>
                </div>
                <div style={S.workflowItem}>
                  <div style={S.workflowTitle}>计量策略</div>
                  <div style={S.workflowDesc}>
                    同时支持固定积分和按结果计量，适配多种业务场景。
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section style={S.right}>
            <div style={S.card}>
              <div style={S.cardHalo} />

              <div style={S.logoWrap}>
                <div style={S.logoBadge}>
                  <img src={wikiLogo} alt="logo" style={S.logoImage} />
                </div>
                <div>
                  <div style={S.logoTextMain}>Wiki 媒体工作台</div>
                  <div style={S.logoTextSub}>Client Login</div>
                </div>
              </div>

              <div style={S.introTag}>Account Access</div>
              <h2 style={S.h1}>{mode === 'login' ? '欢迎登录' : '创建账户'}</h2>
              <p style={S.sub}>
                {mode === 'login'
                  ? '请输入账号信息继续访问控制台。'
                  : '填写注册信息后将自动切回登录并保留账号信息。'}
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
                    placeholder={mode === 'login' ? '请输入密码' : '请输入至少 6 位密码'}
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
                    aria-label={showPwd ? '隐藏密码' : '显示密码'}
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
                      {mode === 'login' ? '登录中...' : '注册中...'}
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

              {currentUser && (
                <div style={S.sessionCard}>
                  <div style={S.sessionTitle}>Current Session</div>
                  <div>用户名：{currentUser.username}</div>
                  <div>邮箱：{currentUser.email}</div>
                  <div>状态：{currentUser.is_active ? '启用中' : '已禁用'}</div>
                  <button
                    type="button"
                    style={S.logoutBtn}
                    onClick={() => {
                      window.localStorage.removeItem(TOKEN_KEY);
                      setCurrentUser(null);
                      setStatus(null);
                      setMessage('已退出登录。');
                    }}
                  >
                    退出登录
                  </button>
                </div>
              )}

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
                    alert('当前项目暂未提供重置密码接口。');
                  }}
                >
                  忘记密码？
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
