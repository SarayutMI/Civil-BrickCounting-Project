import { useState } from 'react';
import * as api from '../api.js';

/* Ported from login.html — folded into the SPA as a component instead of a
   separate HTML page. Same mockup credentials hint, same error handling. */
export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}</button>
        <div className="err">{err}</div>
        <div className="hint">Mockup — ทดลองใช้ user: <strong>admin</strong> / pass: <strong>password</strong></div>
      </form>
    </div>
  );
}
