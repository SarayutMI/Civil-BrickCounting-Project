import { useEffect, useMemo, useState } from 'react';
import Icon from '../icons/Icon.jsx';
import * as api from '../api.js';

/* ===================================================================
   Device Monitor — health of the whole image pipeline, from the camera
   on site to the web page: an animated flow diagram (data "flows" along
   the lines that are working, broken links turn red) plus bento blocks of
   what the ESP32 bridge reports (GET /api/devices, refreshed every 5 s).
=================================================================== */

const REFRESH_MS = 5000;
const agoSec = (iso, now) => (iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000)) : null);
function agoText(sec) {
  if (sec === null || sec === undefined) return '—';
  if (sec < 60) return `${sec} วินาทีที่แล้ว`;
  if (sec < 3600) return `${Math.floor(sec / 60)} นาทีที่แล้ว`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ชม. ${Math.floor((sec % 3600) / 60)} นาทีที่แล้ว`;
  return `${Math.floor(sec / 86400)} วันที่แล้ว`;
}
const kb = (b) => (b === null || b === undefined ? '—' : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1024).toFixed(0)} KB`);
const gb = (b) => (b === null || b === undefined ? '—' : `${(b / 1073741824).toFixed(1)} GB`);
const n1 = (v, d = 1) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));
// chip die temperature; heartbeats stored before firmware 2026.09.27b carry it as tempC
const chipT = (o) => o?.chipTempC ?? o?.tempC;
function duration(ms) {
  if (ms === null || ms === undefined) return '—';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} วัน ${h} ชม.` : h ? `${h} ชม. ${m} นาที` : `${m} นาที ${s % 60} วิ`;
}
function rssiInfo(rssi) {
  if (rssi === null || rssi === undefined) return { bars: 0, text: '—' };
  if (rssi >= -55) return { bars: 4, text: 'ดีมาก' };
  if (rssi >= -67) return { bars: 3, text: 'ดี' };
  if (rssi >= -75) return { bars: 2, text: 'พอใช้' };
  return { bars: 1, text: 'อ่อน' };
}

/* ---------- pipeline status: one state per node and per link ---------- */
// node state: 'ok' | 'warn' | 'down' | 'idle'; link state: 'flow' (data moving) | 'idle' | 'down'
function pipeline(data, dev) {
  const now = new Date(data.now).getTime();
  const t = dev?.telemetry || null;
  const online = !!dev?.online;
  const intervalMs = t?.cycle?.intervalMs || 15000;
  const uploadAge = agoSec(dev?.lastUploadAt, now);
  const recentUpload = online && uploadAge !== null && uploadAge * 1000 < Math.max(intervalMs * 4, 90000);
  const camStreak = t?.camera?.failStreak || 0;
  const detAge = agoSec(dev?.lastDetectionAt, now);
  const detRecent = detAge !== null && detAge < 180;
  const ai = data.ai || {};
  const db = data.server?.db || {};
  const discord = data.discord || {};
  const rssi = t?.wifi?.rssi;

  const nodes = {
    camera: {
      label: 'กล้อง Hikvision', icon: 'camera',
      state: !dev?.lastSeen ? 'idle' : !online ? 'idle' : camStreak >= 3 ? 'down' : camStreak > 0 ? 'warn' : 'ok',
      metric: t?.camera?.fetchMs ? `ดึงภาพ ${n1(t.camera.fetchMs / 1000)} วิ · ${kb(t.camera.bytes)}` : (camStreak ? t?.camera?.lastError : '—'),
    },
    esp: {
      label: 'ESP32 Bridge', icon: 'cpu',
      state: !dev?.lastSeen ? 'idle' : online ? 'ok' : 'down',
      metric: online ? `RAM ว่าง ${kb(t?.heap?.free)} · ชิป ${n1(chipT(t))}°C` : dev?.lastSeen ? `ขาดการติดต่อ ${agoText(agoSec(dev.lastSeen, now))}` : 'ยังไม่เคยส่งข้อมูล',
    },
    net: {
      label: 'WiFi / 4G', icon: 'wifi',
      state: !online ? (dev?.lastSeen ? 'down' : 'idle') : rssi !== null && rssi !== undefined && rssi < -75 ? 'warn' : 'ok',
      metric: online ? `${rssi ?? '—'} dBm · ${n1(t?.ftp?.kbps, 0)} KB/s` : '—',
    },
    server: {
      label: 'Server (FTP)', icon: 'server',
      state: db.ok === false ? 'down' : dev?.cameraStatus === 'live' || recentUpload ? 'ok' : 'warn',
      metric: `CPU ${n1(data.server?.load?.[0], 2)} / ${data.server?.cpus ?? '—'} core`,
    },
    ai: {
      label: 'AI (YOLO)', icon: 'ai',
      state: ai.ok === false ? 'down' : ai.ok && !ai.modelLoaded ? 'warn' : 'ok',
      metric: ai.ok ? (ai.modelLoaded ? `พร้อม · ตอบ ${ai.latencyMs} ms` : 'รอโหลดโมเดล (โหลดตอนใช้ครั้งแรก)') : 'ไม่ตอบสนอง',
    },
    db: {
      label: 'Database / Timeline', icon: 'db',
      state: db.ok ? 'ok' : 'down',
      metric: db.ok ? `ตอบ ${db.latencyMs} ms` : 'เชื่อมต่อไม่ได้',
    },
    web: { label: 'Web Dashboard', icon: 'monitor', state: 'ok', metric: 'คุณกำลังดูอยู่' },
    discord: {
      label: 'Discord', icon: 'discord',
      state: !discord.configured ? 'warn' : discord.lastAlert && !discord.lastAlert.ok ? 'down' : 'ok',
      metric: !discord.configured ? 'ยังไม่ได้ตั้ง Webhook' : discord.lastAlert ? `ล่าสุด ${discord.lastAlert.ok ? 'ส่งสำเร็จ' : 'ส่งไม่สำเร็จ'}` : 'พร้อมส่ง',
    },
  };
  const link = (ok, flowing) => (!ok ? 'down' : flowing ? 'flow' : 'idle');
  const links = {
    'camera-esp': link(nodes.camera.state !== 'down', recentUpload),
    'esp-net': link(online || !dev?.lastSeen, recentUpload),
    'net-server': link(online || !dev?.lastSeen, recentUpload),
    'server-ai': link(ai.ok !== false, detRecent),
    'ai-db': link(ai.ok !== false && db.ok !== false, detRecent),
    'db-web': link(db.ok !== false, true),
    // not configured = unused (grey), not broken; red only when a send to a configured webhook failed
    'server-discord': !discord.configured ? 'idle' : link(!(discord.lastAlert && !discord.lastAlert.ok), (discord.active || []).length > 0),
  };
  return { nodes, links, recentUpload, uploadAge, detAge, online };
}

// What the system is doing right now, in one sentence (shown above the diagram).
function headline(data, dev, p) {
  if (!dev) return { tone: 'idle', text: 'ยังไม่มีกล้องโหมด FTP ในระบบ' };
  if (!dev.lastSeen) return { tone: 'warn', text: 'ESP32 ยังไม่เคยส่งข้อมูลมา — ต้อง flash firmware เวอร์ชันที่มี Device Monitor (heartbeat) ก่อน' };
  if (!p.online) return { tone: 'down', text: `ESP32 ขาดการติดต่อ ${agoText(agoSec(dev.lastSeen, new Date(data.now).getTime()))} — เน็ตหน้างานหลุด หรือบอร์ดดับ` };
  const t = dev.telemetry;
  if ((t?.camera?.failStreak || 0) >= 3) return { tone: 'down', text: `ESP32 ออนไลน์ แต่ดึงภาพจากกล้องไม่ได้: ${t.camera.lastError || 'ไม่ทราบสาเหตุ'}` };
  if (data.ai && data.ai.ok === false) return { tone: 'down', text: 'ภาพเข้ามาปกติ แต่ AI service ไม่ตอบสนอง — การนับอิฐหยุด' };
  if (!p.recentUpload) return { tone: 'warn', text: `ESP32 ออนไลน์ แต่ไม่มีภาพใหม่ ${agoText(p.uploadAge)}` };
  const gap = t?.lastUploadAgoMs !== undefined && dev.telemetry?.prevIntervalMs ? ` · ห่างจากภาพก่อนหน้า ${n1(dev.telemetry.prevIntervalMs / 1000)} วินาที` : '';
  const det = p.detAge !== null ? ` · AI ตรวจล่าสุด ${agoText(p.detAge)}` : ' · ไม่มีงานกำลังดำเนินการ (AI ไม่ได้ตรวจ)';
  return { tone: 'ok', text: `กำลังส่งภาพ — ภาพล่าสุดถึง server ${agoText(p.uploadAge)}${gap}${det}` };
}

/* ---------- animated flow diagram ---------- */
const POS = { camera: [80, 90], esp: [250, 90], net: [420, 90], server: [590, 90], ai: [760, 90], db: [930, 90], web: [930, 290], discord: [590, 290] };
const EDGES = [
  ['camera-esp', 'M112 90 H218'],
  ['esp-net', 'M282 90 H388'],
  ['net-server', 'M452 90 H558'],
  ['server-ai', 'M622 90 H728'],
  ['ai-db', 'M792 90 H898'],
  ['db-web', 'M930 168 V258'],
  ['server-discord', 'M590 168 V258'],
];
const STATE_TEXT = { ok: 'ปกติ', warn: 'ต้องตรวจสอบ', down: 'มีปัญหา', idle: 'ไม่มีข้อมูล' };

function FlowDiagram({ p }) {
  return (
    <svg className="flow" viewBox="0 30 1010 340" role="img" aria-label="แผนภาพการไหลของข้อมูลในระบบ">
      <defs>
        <filter id="flow-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {EDGES.map(([key, d]) => {
        const st = p.links[key];
        const [x1, y1] = d.match(/M(\d+) (\d+)/).slice(1).map(Number);
        const horiz = d.includes('H');
        const end = Number(d.match(/[HV](\d+)/)[1]);
        const mx = horiz ? (x1 + end) / 2 : x1, my = horiz ? y1 : (y1 + end) / 2;
        return (
          <g key={key} className={`edge edge-${st}`}>
            <path d={d} className="edge-base" />
            {st === 'flow' && (
              <>
                <path d={d} className="edge-flow" />
                {[0, 0.9].map((delay) => (
                  <circle key={delay} r="4.5" className="edge-dot" filter="url(#flow-glow)">
                    <animateMotion dur="1.8s" begin={`${delay}s`} repeatCount="indefinite" path={d} />
                  </circle>
                ))}
              </>
            )}
            {st === 'down' && <g className="edge-x" transform={`translate(${mx} ${my})`}><circle r="10" /><path d="M-4 -4 L4 4 M4 -4 L-4 4" /></g>}
            <path d={horiz ? `M${end - 9} ${y1 - 6} L${end} ${y1} L${end - 9} ${y1 + 6}` : `M${x1 - 6} ${end - 9} L${x1} ${end} L${x1 + 6} ${end - 9}`} className="edge-arrow" />
          </g>
        );
      })}
      {Object.entries(p.nodes).map(([key, n]) => {
        const [x, y] = POS[key];
        return (
          <g key={key} className={`fnode fnode-${n.state}`} transform={`translate(${x} ${y})`}>
            {n.state === 'ok' && <circle r="36" className="fnode-pulse" />}
            <circle r="31" className="fnode-ring" />
            <circle r="26" className="fnode-bg" />
            <Icon name={n.icon} x="-13" y="-13" width="26" height="26" className="fnode-icon" />
            <circle cx="22" cy="-22" r="7" className="fnode-dot" />
            <text y="52" className="fnode-label">{n.label}</text>
            <text y="68" className="fnode-metric">{String(n.metric || '').slice(0, 34)}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Sparkline({ values, color = 'var(--accent)', height = 34 }) {
  const v = values.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  if (v.length < 2) return <div className="spark-empty">ข้อมูลไม่พอสำหรับกราฟ</div>;
  const W = 200, min = Math.min(...v), max = Math.max(...v), rng = max - min || 1;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * W).toFixed(1)},${(height - 3 - ((y - min) / rng) * (height - 6)).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
      <polyline points={`0,${height} ${pts} ${W},${height}`} fill={color} opacity="0.1" stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
function Bar({ pct, tone }) {
  return <div className="dm-bar"><div className={`dm-bar-fill ${tone || ''}`} style={{ width: `${Math.min(Math.max(pct || 0, 0), 100)}%` }} /></div>;
}
function Block({ icon, title, children, span, tone }) {
  return (
    <div className={`dm-block${span ? ` span-${span}` : ''}${tone ? ` tone-${tone}` : ''}`}>
      <div className="dm-block-head"><span className="dm-block-icon"><Icon name={icon} /></span>{title}</div>
      {children}
    </div>
  );
}
const Row = ({ k, v }) => <div className="dm-row"><span>{k}</span><strong>{v}</strong></div>;

export default function DeviceMonitor() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [devId, setDevId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const r = await api.getDevices();
      if (cancelled) return;
      if (r) { setData(r); setError(null); } else setError('โหลดข้อมูลไม่สำเร็จ');
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const dev = useMemo(() => (data ? data.devices.find((d) => d.cameraId === devId) || data.devices[0] || null : null), [data, devId]);
  if (!data) return <section className="view active"><div className="cell-muted" style={{ padding: 40 }}>{error || 'กำลังโหลด...'}</div></section>;

  const now = new Date(data.now).getTime();
  const p = pipeline(data, dev);
  const head = headline(data, dev, p);
  const t = dev?.telemetry || null;
  const hist = dev?.history || [];
  const heapPct = t?.heap?.total ? ((t.heap.total - t.heap.free) / t.heap.total) * 100 : null;
  const rs = rssiInfo(t?.wifi?.rssi);
  const srv = data.server || {};
  const memUsedPct = srv.memTotal ? ((srv.memTotal - srv.memFree) / srv.memTotal) * 100 : null;
  const diskUsedPct = srv.disk ? ((srv.disk.total - srv.disk.free) / srv.disk.total) * 100 : null;
  const cyc = t?.cycle || {};
  const okRate = cyc.count ? Math.round(((cyc.ok || 0) / cyc.count) * 100) : null;
  const phases = [['ดึงภาพจากกล้อง', t?.camera?.fetchMs], ['เริ่ม FTP', t?.ftp?.startMs], ['ส่งภาพ', t?.ftp?.sendMs]];
  const phaseMax = Math.max(...phases.map(([, v]) => v || 0), 1);
  const ALERT_LABEL = { noImage: 'ไม่พบภาพ (Loss data)', cameraOffline: 'กล้องออฟไลน์', internetDown: 'เน็ตหน้างาน / ESP32 หลุด', aiStopped: 'AI หยุดทำงาน', chipHot: 'ชิป ESP32 ร้อนเกิน 75°C', serverOffline: 'Server เริ่ม / หยุด' };

  return (
    <section className="view active device-monitor">
      <div className="section-head">
        <div><h2>Device Monitor</h2><p>สถานะอุปกรณ์และการไหลของข้อมูลทั้งระบบ · อัปเดตทุก {REFRESH_MS / 1000} วินาที</p></div>
        {data.devices.length > 1 && (
          <select className="select" value={dev?.cameraId || ''} onChange={(e) => setDevId(e.target.value)}>
            {data.devices.map((d) => <option key={d.cameraId} value={d.cameraId}>{d.cameraName}{d.zone ? ` — ${d.zone}` : ''}</option>)}
          </select>
        )}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">
          <h3>Flow การทำงานของระบบ {dev ? `· ${dev.cameraName}` : ''}</h3>
          <div className="flow-legend">
            <span><i className="lg-flow" />กำลังส่งข้อมูล</span><span><i className="lg-idle" />ว่าง</span><span><i className="lg-down" />ขาด / มีปัญหา</span>
          </div>
        </div>
        <div className="card-body">
          <div className={`flow-headline tone-${head.tone}`}><span className="fh-dot" />{head.text}</div>
          <div className="flow-wrap"><FlowDiagram p={p} /></div>
          <div className="flow-states">
            {Object.values(p.nodes).map((n) => <span key={n.label} className={`fs fs-${n.state}`}>{n.label}: {STATE_TEXT[n.state]}</span>)}
          </div>
        </div>
      </div>

      <div className="dm-grid">
        <Block icon="wifi" title="การเชื่อมต่อ" tone={p.online ? 'ok' : dev?.lastSeen ? 'down' : 'idle'}>
          <div className="dm-big">{p.online ? 'ออนไลน์' : dev?.lastSeen ? 'ออฟไลน์' : 'ยังไม่เคยเชื่อมต่อ'}</div>
          <Row k="ส่งข้อมูลล่าสุด" v={agoText(agoSec(dev?.lastSeen, now))} />
          <Row k="IP ภายนอก (หน้างาน)" v={dev?.ip || '—'} />
          <Row k="เปิดเครื่องมาแล้ว" v={duration(t?.uptimeMs)} />
          <Row k="รีบูตครั้งล่าสุดเพราะ" v={t?.resetReason || '—'} />
        </Block>

        <Block icon="camera" title="ภาพล่าสุด" tone={p.recentUpload ? 'ok' : 'warn'}>
          <div className="dm-big">{agoText(p.uploadAge)}</div>
          <Row k="เวลาที่ภาพถึง server" v={dev?.lastUploadAt ? new Date(dev.lastUploadAt).toLocaleTimeString('th-TH', { hour12: false }) : '—'} />
          <Row k="ห่างจากภาพก่อนหน้า" v={t?.prevIntervalMs ? `${n1(t.prevIntervalMs / 1000)} วินาที` : '—'} />
          <Row k="ขนาดภาพ" v={kb(t?.camera?.bytes)} />
          <div className="dm-sub">ช่วงห่างระหว่างภาพ (วินาที)</div>
          <Sparkline values={hist.map((h) => (h.gapMs ? h.gapMs / 1000 : null))} color="var(--purple)" />
        </Block>

        <Block icon="upload" title="ความเร็วส่งภาพ (อัปโหลด)">
          <div className="dm-big">{n1(t?.ftp?.kbps, 0)} <small>KB/s</small></div>
          <div className="dm-sub">≈ {t?.ftp?.kbps ? n1((t.ftp.kbps * 8) / 1024, 2) : '—'} Mbps · หน้าต่าง TCP {t?.tcp?.sndBuf ? `${(t.tcp.sndBuf / 1024).toFixed(1)} KB` : '—'}{t?.tcp?.sndBuf && t.tcp.sndBuf < 8192 ? ' (build เดิม — Plan B จะเร็วกว่า)' : ''}</div>
          <Sparkline values={hist.map((h) => h.kbps)} />
          <div className="dm-sub">เวลาแต่ละขั้นในรอบล่าสุด</div>
          {phases.map(([k, v]) => (
            <div key={k} className="dm-phase"><span>{k}</span><Bar pct={v ? (v / phaseMax) * 100 : 0} /><strong>{v ? `${n1(v / 1000)} วิ` : '—'}</strong></div>
          ))}
        </Block>

        <Block icon="wifi" title="WiFi">
          <div className="dm-big"><span className="rssi">{[1, 2, 3, 4].map((b) => <i key={b} className={b <= rs.bars ? 'on' : ''} style={{ height: 4 + b * 4 }} />)}</span> {t?.wifi?.rssi ?? '—'} <small>dBm · {rs.text}</small></div>
          <Row k="SSID" v={t?.wifi?.ssid || '—'} />
          <Row k="Channel" v={t?.wifi?.channel ?? '—'} />
          <Row k="IP ในวง LAN" v={t?.wifi?.ip || '—'} />
          <Sparkline values={hist.map((h) => h.rssi)} color="var(--green)" />
        </Block>

        <Block icon="board" title="หน่วยความจำ (RAM)" tone={t?.heap?.maxBlock && t.heap.maxBlock < 20000 ? 'warn' : undefined}>
          <div className="dm-big">{kb(t?.heap?.free)} <small>ว่าง จาก {kb(t?.heap?.total)}</small></div>
          <Bar pct={heapPct} tone={heapPct > 85 ? 'bad' : heapPct > 70 ? 'warn' : ''} />
          <Row k="ใช้ไป" v={heapPct !== null ? `${n1(heapPct, 0)}%` : '—'} />
          <Row k="ว่างน้อยสุดตั้งแต่เปิดเครื่อง" v={kb(t?.heap?.min)} />
          <Row k="ก้อนว่างใหญ่สุด" v={kb(t?.heap?.maxBlock)} />
          <Sparkline values={hist.map((h) => h.heapFree)} color="var(--amber)" />
        </Block>

        <Block icon="cpu" title="CPU / โหลดการทำงาน">
          <div className="dm-big">{cyc.busyPct ?? '—'}<small>% ของเวลาทำงาน</small></div>
          <Bar pct={cyc.busyPct} />
          <Row k="ชิป" v={t?.chip?.model ? `${t.chip.model} rev ${t.chip.rev}` : '—'} />
          <Row k="Core / ความเร็ว" v={t?.chip?.cores ? `${t.chip.cores} core · ${t.chip.cpuMHz} MHz` : '—'} />
          <div className="dm-sub">% = สัดส่วนเวลาที่บอร์ดกำลังดึง/ส่งภาพ เทียบกับเวลาที่รอรอบถัดไป (ESP32 ไม่มีตัววัด % CPU แบบคอมพิวเตอร์)</div>
        </Block>

        <Block icon="thermo" title="อุณหภูมิชิป ESP32" tone={chipT(t) > 75 ? 'down' : chipT(t) > 60 ? 'warn' : undefined}>
          <div className="dm-big">{n1(chipT(t))}<small>°C</small></div>
          <Sparkline values={hist.map(chipT)} color="var(--orange)" />
          <div className="dm-sub">วัดจากเซ็นเซอร์ในตัวชิป ESP32-C6 = อุณหภูมิของชิป ไม่ใช่อุณหภูมิอากาศ (ปกติสูงกว่าอากาศรอบบอร์ด 5–15°C, ขึ้นตอนส่งภาพ) · เกิน 75°C ควรระบายความร้อน</div>
        </Block>

        <Block icon="thermo" title="เซ็นเซอร์ DHT11 (อุณหภูมิ/ความชื้นรอบกล่อง)" tone={t?.dht?.present ? undefined : 'idle'}>
          {t?.dht?.present ? (
            <>
              <div className="dm-big">{n1(t.dht.tempC)}<small>°C</small> · {n1(t.dht.humidity, 0)}<small>%RH</small></div>
              <Sparkline values={hist.map((h) => h.dhtTemp)} color="var(--orange)" />
            </>
          ) : (
            <>
              <div className="dm-big dm-muted">ยังไม่ติดตั้ง</div>
              <div className="dm-sub">ต่อ DHT11 เข้าขา GPIO ของ ESP32 แล้วเพิ่ม <code>#define DHT_PIN &lt;ขา&gt;</code> ใน config.h — หน้านี้จะแสดงค่าเอง</div>
            </>
          )}
        </Block>

        <Block icon="ai" title="GPU" tone="idle">
          <div className="dm-big dm-muted">ไม่มี GPU</div>
          <Row k="ESP32-C6" v="ไม่มี GPU (ไมโครคอนโทรลเลอร์)" />
          <Row k="Server" v={srv.gpu ? srv.gpu : 'ไม่มี GPU — AI รันด้วย CPU'} />
          <Row k="AI ตอบกลับ" v={data.ai?.ok ? `${data.ai.latencyMs} ms` : 'ไม่ตอบสนอง'} />
        </Block>

        <Block icon="clock" title="รอบการทำงานของ ESP32" tone={(cyc.consecutiveFail || 0) > 0 ? 'warn' : undefined}>
          <div className="dm-big">{okRate !== null ? `${okRate}%` : '—'} <small>สำเร็จ</small></div>
          <Row k="รอบทั้งหมด (สำเร็จ / ล้ม)" v={cyc.count ? `${cyc.count.toLocaleString()} (${(cyc.ok || 0).toLocaleString()} / ${(cyc.fail || 0).toLocaleString()})` : '—'} />
          <Row k="ล้มติดกันตอนนี้" v={cyc.consecutiveFail ?? '—'} />
          <Row k="รอบล่าสุดใช้เวลา" v={cyc.lastMs ? `${n1(cyc.lastMs / 1000)} วิ` : '—'} />
          <Row k="ตั้งรอบส่งไว้ทุก" v={cyc.intervalMs ? `${cyc.intervalMs / 1000} วิ` : '—'} />
          {t?.camera?.lastError && <div className="dm-err">ล่าสุด: {t.camera.lastError}</div>}
        </Block>

        <Block icon="server" title="Server" tone={srv.db && !srv.db.ok ? 'down' : undefined}>
          <Row k="CPU load (1 นาที)" v={srv.load ? `${n1(srv.load[0], 2)} / ${srv.cpus} core` : '—'} />
          <Bar pct={srv.load ? (srv.load[0] / srv.cpus) * 100 : 0} />
          <Row k="RAM" v={srv.memTotal ? `${gb(srv.memTotal - srv.memFree)} / ${gb(srv.memTotal)}` : '—'} />
          <Bar pct={memUsedPct} tone={memUsedPct > 90 ? 'bad' : ''} />
          <Row k="ดิสก์" v={srv.disk ? `${gb(srv.disk.total - srv.disk.free)} / ${gb(srv.disk.total)}` : '—'} />
          <Bar pct={diskUsedPct} tone={diskUsedPct > 90 ? 'bad' : diskUsedPct > 80 ? 'warn' : ''} />
          <Row k="เปิดมาแล้ว" v={srv.uptimeSec ? duration(srv.uptimeSec * 1000) : '—'} />
          <Row k="AI โมเดลอิฐ / คน" v={`${data.ai?.modelLoaded ? 'โหลดแล้ว' : 'ยังไม่โหลด'} / ${data.ai?.personModelLoaded ? 'โหลดแล้ว' : 'ยังไม่โหลด'}`} />
        </Block>

        <Block icon="discord" title="Discord แจ้งเตือน" tone={!data.discord.configured ? 'warn' : data.discord.lastAlert && !data.discord.lastAlert.ok ? 'down' : 'ok'}>
          <div className="dm-big">{data.discord.configured ? 'ตั้ง Webhook แล้ว' : 'ยังไม่ได้ตั้ง Webhook'}</div>
          {Object.entries(ALERT_LABEL).map(([k, label]) => (
            <div key={k} className="dm-alert"><span className={`dm-chip ${data.discord.enabled[k] ? 'on' : ''}`}>{data.discord.enabled[k] ? 'เปิด' : 'ปิด'}</span>{label}</div>
          ))}
          {data.discord.active.length > 0 && <div className="dm-err">กำลังแจ้งเตือนอยู่: {data.discord.active.length} เรื่อง</div>}
          <Row k="ส่งล่าสุด" v={data.discord.lastAlert ? `${new Date(data.discord.lastAlert.at).toLocaleString('th-TH', { hour12: false })} · ${data.discord.lastAlert.ok ? 'สำเร็จ' : 'ไม่สำเร็จ'}` : 'ยังไม่มี'} />
          {data.discord.lastAlert && !data.discord.lastAlert.ok && <div className="dm-err">{data.discord.lastAlert.error}</div>}
        </Block>

        <Block icon="board" title="Firmware / บอร์ด" span={2}>
          <Row k="Firmware" v={t?.fw || '—'} />
          <Row k="Flash / โปรแกรม" v={t?.chip?.flashBytes ? `${kb(t.chip.flashBytes)} / ${kb(t.chip.sketchBytes)}` : '—'} />
          <Row k="TCP send buffer / window" v={t?.tcp?.sndBuf ? `${t.tcp.sndBuf.toLocaleString()} / ${t.tcp.wnd.toLocaleString()} B` : '—'} />
          <Row k="งานที่ใช้กล้องนี้ (กำลังดำเนินการ)" v={dev?.runningTasks?.length ? dev.runningTasks.map((x) => x.name).join(', ') : 'ไม่มี'} />
        </Block>
      </div>
    </section>
  );
}
