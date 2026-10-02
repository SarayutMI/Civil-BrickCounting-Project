import { useEffect, useState } from 'react';
import { useToast } from '../../components/Toast.jsx';
import * as api from '../../api.js';

export default function AlertTab() {
  const toast = useToast();
  const [cfg, setCfg] = useState({ webhook: '', cameraOffline: true, serverOffline: true, aiStopped: true, internetDown: false, noImage: true, chipHot: true });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getAlertConfig();
        setCfg({
          webhook: data.webhook || '',
          cameraOffline: !!data.cameraOffline,
          serverOffline: !!data.serverOffline,
          aiStopped: !!data.aiStopped,
          internetDown: !!data.internetDown,
          noImage: !!data.noImage,
          chipHot: data.chipHot !== false,
        });
      } catch (err) {
        console.error('โหลด Alert Config ไม่สำเร็จ', err);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  async function saveAlertConfig() {
    const ok = await api.updateAlertConfig(cfg);
    if (ok) toast('บันทึกการตั้งค่าแจ้งเตือนแล้ว', 'success');
    else toast('บันทึกไม่สำเร็จ');
  }

  async function testAlert() {
    toast('กำลังส่งการแจ้งเตือนทดสอบไปยัง Discord...');
    const { ok, data } = await api.testAlert();
    toast(data.message || (ok ? 'ส่งการแจ้งเตือนทดสอบสำเร็จ' : 'ส่งการแจ้งเตือนทดสอบไม่สำเร็จ'), ok ? 'success' : 'info');
  }

  if (!loaded) return <div id="panel-alert" className="settings-panel active" />;

  return (
    <div id="panel-alert" className="settings-panel active">
      <div className="card">
        <div className="card-head"><h3>Alert Configuration</h3></div>
        <div className="card-body">
          <div className="form-group"><label>Discord Webhook</label><input className="input" placeholder="https://discord.com/api/webhooks/..." value={cfg.webhook} onChange={(e) => setCfg({ ...cfg, webhook: e.target.value })} /></div>
          <div className="divider" />
          <label><input type="checkbox" checked={cfg.cameraOffline} onChange={(e) => setCfg({ ...cfg, cameraOffline: e.target.checked })} /> แจ้งเตือนกล้อง Offline</label><br />
          <label><input type="checkbox" checked={cfg.serverOffline} onChange={(e) => setCfg({ ...cfg, serverOffline: e.target.checked })} /> แจ้งเตือน Server Offline</label><br />
          <label><input type="checkbox" checked={cfg.aiStopped} onChange={(e) => setCfg({ ...cfg, aiStopped: e.target.checked })} /> แจ้งเตือน AI หยุดทำงาน</label><br />
          <label><input type="checkbox" checked={cfg.internetDown} onChange={(e) => setCfg({ ...cfg, internetDown: e.target.checked })} /> แจ้งเตือน Internet Down</label><br />
          <label><input type="checkbox" checked={cfg.noImage} onChange={(e) => setCfg({ ...cfg, noImage: e.target.checked })} /> แจ้งเตือนเมื่อไม่พบภาพ</label><br />
          <label><input type="checkbox" checked={cfg.chipHot} onChange={(e) => setCfg({ ...cfg, chipHot: e.target.checked })} /> แจ้งเตือนชิป ESP32 ร้อนเกิน 75°C</label>
          <div className="divider" />
          <div className="action-row">
            <button className="btn btn-secondary" onClick={saveAlertConfig}>บันทึกการตั้งค่า</button>
            <button className="btn btn-secondary" onClick={testAlert}>ส่งการแจ้งเตือนทดสอบ</button>
          </div>
        </div>
      </div>
    </div>
  );
}
