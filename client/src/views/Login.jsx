import { useState } from 'react';
import * as api from '../api.js';
import Icon from '../icons/Icon.jsx';

/* Login form. Credentials are checked by the server (bcrypt hash in table users); the
   session is an HttpOnly cookie, so nothing about the user is stored in the browser. */
export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    if (!username.trim() || !password) {
      setErr('กรุณากรอก username และ password');
      return;
    }
    setBusy(true);
    try {
      const { ok, data } = await api.login(username.trim(), password);
      if (ok && data.success) {
        onLogin(data.user);
      } else {
        setErr(data.message || 'เข้าสู่ระบบไม่สำเร็จ');
      }
    } catch (_) {
      setErr('เชื่อมต่อ backend ไม่สำเร็จ — ตรวจสอบว่ารัน server.js อยู่หรือไม่');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="card" onSubmit={handleSubmit}>
        <div className="brand"><strong>CIVIL</strong><small>AI Brick Construction Monitoring</small></div>
        <div className="form-group">
          <label>Username</label>
          <input autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Password</label>
          <div className="pw-field">
            <input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button
              type="button" className="pw-toggle" onClick={() => setShowPassword((s) => !s)}
              title={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'} aria-pressed={showPassword}
            >
              <Icon name={showPassword ? 'eyeOff' : 'eye'} />
            </button>
          </div>
        </div>
        <button type="submit" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}</button>
        <div className="err">{err}</div>
      </form>
    </div>
  );
}
