import { useEffect, useRef, useState } from 'react';
import wikiLogo from './微信图片_20260310102730_18_61.png';

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
          const alpha = 0.06 + depth * 0.3;

          ctx.beginPath();
          ctx.fillStyle = `rgba(58, 149, 255, ${alpha})`;
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

  const CYAN = '#8de4ff';
  const LINE = 'rgba(109, 174, 255, 0.20)';
  const PANEL = 'rgba(7, 17, 36, 0.82)';
  const GLOW = 'rgba(92, 194, 255, 0.28)';

  const S = {
    page: {
      position: 'relative',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      background:
        'radial-gradient(circle at 50% 14%, rgba(38, 114, 255, 0.18), transparent 22%), linear-gradient(180deg, #030816 0%, #040914 46%, #02050c 100%)',
      fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    },
    grid: {
      position: 'absolute',
      inset: 0,
      backgroundImage:
        'linear-gradient(rgba(76, 115, 176, 0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(76, 115, 176, 0.07) 1px, transparent 1px)',
      backgroundSize: '64px 64px',
      maskImage:
        'linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.35) 72%, transparent)',
      pointerEvents: 'none',
      zIndex: 0,
    },
    glowTop: {
      position: 'fixed',
      top: -90,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 860,
      height: 260,
      borderRadius: '50%',
      background:
        'radial-gradient(circle, rgba(80,169,255,0.20) 0%, rgba(80,169,255,0.07) 42%, transparent 72%)',
      filter: 'blur(46px)',
      pointerEvents: 'none',
      zIndex: 0,
    },
    card: {
      position: 'relative',
      zIndex: 2,
      width: '100%',
      maxWidth: 472,
      margin: '0 16px',
      padding: 'clamp(34px, 5vw, 52px) clamp(24px, 4vw, 42px)',
      background: PANEL,
      backdropFilter: 'blur(18px)',
      WebkitBackdropFilter: 'blur(18px)',
      borderRadius: 30,
      border: `1px solid ${LINE}`,
      boxShadow: `0 32px 72px rgba(0, 0, 0, 0.56), 0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 46px ${GLOW}`,
    },
    cardHalo: {
      position: 'absolute',
      inset: -1,
      borderRadius: 30,
      pointerEvents: 'none',
      background:
        'linear-gradient(180deg, rgba(140,222,255,0.18), rgba(18,47,89,0.02) 38%, rgba(0,0,0,0) 100%)',
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
      gap: 16,
      marginBottom: 22,
    },
    logoBadge: {
      width: 82,
      height: 82,
      borderRadius: 24,
      background:
        'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(226,239,255,0.92))',
      boxShadow:
        '0 16px 34px rgba(2, 15, 41, 0.32), inset 0 1px 0 rgba(255,255,255,0.72)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    logoImage: {
      width: 66,
      height: 66,
      objectFit: 'contain',
    },
    logoText: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      lineHeight: 1.2,
    },
    logoTextMain: {
      fontSize: 24,
      fontWeight: 800,
      letterSpacing: 0.4,
      color: '#f6fbff',
      textShadow: '0 0 18px rgba(135,226,255,0.14)',
    },
    logoTextSub: {
      fontSize: 12,
      color: 'rgba(174, 204, 240, 0.78)',
      fontWeight: 500,
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
    },
    divider: {
      width: '100%',
      height: 1,
      margin: '0 0 22px',
      background:
        'linear-gradient(90deg, transparent, rgba(86,157,255,0.34), transparent)',
    },
    introTag: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 14,
      padding: '8px 12px',
      borderRadius: 999,
      border: '1px solid rgba(112, 196, 255, 0.18)',
      background: 'rgba(6, 16, 34, 0.62)',
      color: 'rgba(170, 222, 255, 0.86)',
      fontSize: 12,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
    },
    h1: {
      color: '#eff7ff',
      fontSize: 'clamp(24px, 4vw, 30px)',
      fontWeight: 800,
      margin: '0 0 8px',
      textShadow: '0 0 18px rgba(135,226,255,0.1)',
    },
    sub: {
      color: 'rgba(179, 202, 232, 0.72)',
      fontSize: 14,
      lineHeight: 1.8,
      margin: '0 0 26px',
    },
    modeSwitch: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 10,
      marginBottom: 24,
      padding: 6,
      background: 'rgba(255,255,255,0.03)',
      borderRadius: 18,
      border: `1px solid ${LINE}`,
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)',
    },
    modeBtn: (active) => ({
      border: '1px solid transparent',
      borderRadius: 13,
      padding: '11px 12px',
      cursor: 'pointer',
      fontWeight: 700,
      fontSize: 14,
      color: active ? '#05111e' : 'rgba(209, 227, 247, 0.78)',
      background: active
        ? 'linear-gradient(180deg, #87e2ff 0%, #56c7ff 100%)'
        : 'rgba(255,255,255,0.02)',
      boxShadow: active ? '0 0 24px rgba(86,199,255,0.28)' : 'none',
      transition: 'all .2s ease',
    }),
    label: {
      display: 'block',
      color: 'rgba(205, 223, 247, 0.9)',
      fontSize: 13,
      fontWeight: 600,
      marginBottom: 8,
      letterSpacing: '0.04em',
    },
    fieldWrap: {
      position: 'relative',
      marginBottom: 18,
    },
    input: (name) => ({
      width: '100%',
      boxSizing: 'border-box',
      background: 'rgba(5, 14, 30, 0.96)',
      border: `1.5px solid ${
        focused === name ? 'rgba(135,226,255,0.58)' : LINE
      }`,
      borderRadius: 16,
      padding: '14px 16px',
      paddingRight: name === 'password' ? 46 : 16,
      color: '#eef6ff',
      caretColor: '#87e2ff',
      fontSize: 15,
      outline: 'none',
      transition: 'border-color .25s, box-shadow .25s, background .25s',
      boxShadow:
        focused === name
          ? '0 0 0 3px rgba(86,199,255,0.12), 0 0 18px rgba(86,199,255,0.1)'
          : 'none',
    }),
    eyeBtn: {
      position: 'absolute',
      right: 13,
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: 'rgba(174, 204, 240, 0.52)',
      padding: 4,
      display: 'flex',
      transition: 'color .2s',
    },
    submitBtn: {
      position: 'relative',
      overflow: 'hidden',
      width: '100%',
      padding: '14px 0',
      borderRadius: 999,
      border: '1px solid rgba(116, 215, 255, 0.24)',
      background: loading
        ? 'rgba(56, 135, 214, 0.42)'
        : 'linear-gradient(180deg, #87e2ff 0%, #56c7ff 100%)',
      color: loading ? 'rgba(255,255,255,0.85)' : '#041120',
      fontSize: 16,
      fontWeight: 800,
      cursor: loading ? 'wait' : 'pointer',
      transform: pressing ? 'scale(0.972)' : 'scale(1)',
      transitionProperty: 'transform, box-shadow, filter',
      transitionDuration: pressing ? '0.08s' : '0.22s',
      boxShadow: pressing
        ? '0 4px 14px rgba(86,199,255,0.26)'
        : '0 0 28px rgba(86,199,255,0.3), inset 0 1px 0 rgba(255,255,255,0.6)',
      filter: pressing ? 'brightness(0.94)' : 'brightness(1)',
      userSelect: 'none',
      letterSpacing: 1.2,
    },
    forgotWrap: {
      textAlign: 'center',
      marginTop: 22,
    },
    forgotLink: {
      position: 'relative',
      display: 'inline-block',
      color: hoverForgot ? CYAN : 'rgba(174, 204, 240, 0.54)',
      fontSize: 14,
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
      background: 'linear-gradient(90deg, #56c7ff, #87e2ff)',
      width: hoverForgot ? '100%' : '0%',
      transition: 'width 0.3s cubic-bezier(.4,0,.2,1)',
    },
    sessionCard: {
      marginTop: 18,
      padding: '14px 16px',
      borderRadius: 16,
      background: 'rgba(4, 12, 26, 0.76)',
      border: `1px solid ${LINE}`,
      color: '#d8ebff',
      fontSize: 14,
      lineHeight: 1.7,
      boxShadow:
        'inset 0 0 0 1px rgba(255,255,255,0.02), 0 0 24px rgba(18,77,148,0.12)',
    },
    sessionTitle: {
      fontSize: 12,
      color: 'rgba(170, 201, 239, 0.74)',
      marginBottom: 6,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
    },
    logoutBtn: {
      marginTop: 12,
      background: 'rgba(255,255,255,0.02)',
      color: '#9fdcff',
      border: `1px solid ${LINE}`,
      borderRadius: 999,
      padding: '9px 14px',
      cursor: 'pointer',
      fontWeight: 700,
    },
    alert: (ok) => ({
      marginTop: 18,
      padding: '12px 16px',
      borderRadius: 14,
      fontSize: 14,
      lineHeight: 1.7,
      background: ok ? 'rgba(16,185,129,0.11)' : 'rgba(239,68,68,0.12)',
      border: `1px solid ${
        ok ? 'rgba(103, 241, 201, 0.18)' : 'rgba(255, 130, 146, 0.16)'
      }`,
      color: ok ? '#8af0ce' : '#ff9ead',
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
          from { opacity: 0; transform: translateY(20px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        * { -webkit-tap-highlight-color: transparent; }
        .login-input {
          background: rgba(5, 14, 30, 0.96) !important;
          color: #eef6ff !important;
          caret-color: #87e2ff;
        }
        .login-input:hover,
        .login-input:focus,
        .login-input:active,
        .login-input:not(:placeholder-shown) {
          background: rgba(5, 14, 30, 0.98) !important;
          color: #eef6ff !important;
        }
        input::placeholder {
          color: rgba(173, 201, 236, 0.30);
        }
        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus,
        input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 1000px rgba(5,14,30,0.98) inset !important;
          -webkit-text-fill-color: #eef6ff !important;
          caret-color: #87e2ff;
          transition: background-color 5000s ease-in-out 0s;
        }
      `}</style>

      <div style={S.page}>
        <div style={S.grid} />
        <div style={S.glowTop} />
        <GridBackground />

        <div style={{ ...S.card, animation: 'cardIn .45s ease both' }}>
          <div style={S.cardHalo} />

          <div style={S.logoWrap}>
            <div style={S.logoBadge}>
              <img
                src={wikiLogo}
                alt="Wiki 鲸创传媒集团"
                style={S.logoImage}
              />
            </div>
            <div style={S.logoText}>
              <span style={S.logoTextMain}>Wiki 鲸创传媒</span>
              <span style={S.logoTextSub}>Media Portal</span>
            </div>
          </div>

          <div style={S.divider} />

          <div style={S.introTag}>Brand Workspace Login</div>
          <h1 style={S.h1}>欢迎回来</h1>
          <p style={S.sub}>
            {mode === 'login'
              ? '请输入账户信息登录系统，登录成功后将自动跳转到个人积分工作台。'
              : '创建新账户后将初始化 1000 积分，并可直接进入工作流系统。'}
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
                placeholder={
                  mode === 'login' ? '请输入密码' : '请输入至少 6 位密码'
                }
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
                    background: 'rgba(255,255,255,0.45)',
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
                alert('当前项目还没有重置密码接口，后续可以继续补上。');
              }}
            >
              忘记密码？
              <span style={S.underline} />
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
