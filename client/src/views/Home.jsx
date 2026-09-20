import { useMemo } from 'react';
import Icon from '../icons/Icon.jsx';
import StatCard from '../components/StatCard.jsx';
import { brickName, pct } from '../utils.jsx';
import * as api from '../api.js';

/* ===================================================================
   Home — ported from app.js renderHome()/renderHomeTimelapses().
   The finished-task gallery previews each task's real time-lapse GIF
   (built by the server from the per-minute snapshots) and links to the
   MP4 / GIF downloads.
=================================================================== */
export default function Home({ tasks, brickTypes, onOpenTask, onGoTask }) {
  const totalTasks = tasks.length;
  const running = tasks.filter((x) => x.status === 'running').length;
  const finished = tasks.filter((x) => x.status === 'finished').length;
  const totalWorkers = new Set(tasks.flatMap((x) => x.workers)).size;
  const totalArea = tasks.reduce((s, x) => s + x.area, 0);
  const todaySuccess = tasks.length
    ? Math.round(tasks.reduce((s, x) => s + (x.area / x.expectedArea) * 100, 0) / tasks.length)
    : 0;

  const runningTasks = tasks.filter((x) => x.status === 'running');
  const finishedTasks = useMemo(() => tasks.filter((x) => x.status === 'finished'), [tasks]);


  return (
    <section id="view-home" className="view active">
      <div className="section-head">
        <div><h2>ภาพรวมโครงการ</h2><p>ติดตามสถานะงานก่ออิฐและการตรวจจับด้วย AI</p></div>
      </div>
      <div id="homeStats" className="grid-stats">
        <StatCard icon={<Icon name="task" />} label="จำนวน Task ทั้งหมด" value={totalTasks} />
        <StatCard icon={<Icon name="play" />} label="กำลังดำเนินการ" value={running} />
        <StatCard icon={<Icon name="check" />} label="เสร็จสิ้นแล้ว" value={finished} />
        <StatCard icon={<Icon name="users" />} label="แรงงานทั้งหมด" value={totalWorkers + ' คน'} />
        <StatCard icon={<Icon name="area" />} label="พื้นที่ก่ออิฐรวม" value={totalArea + ' m²'} />
        <StatCard icon={<Icon name="percent" />} label="ความสำเร็จวันนี้" value={todaySuccess + '%'} />
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head"><h3>งานที่กำลังดำเนินการ</h3><button className="btn btn-secondary btn-sm" onClick={onGoTask}>ดูทั้งหมด</button></div>
          <div className="card-body" id="homeRunningList">
            {runningTasks.length === 0 ? (
              <div className="empty-state"><Icon name="empty" /><div className="e-title">ยังไม่มีงานที่กำลังดำเนินการ</div></div>
            ) : runningTasks.map((x) => (
              <div className="list-row" key={x.id}>
                <div className="l-main">
                  <div className="l-avatar">{x.zone.slice(-2)}</div>
                  <div>
                    <div className="l-name">{x.name}</div>
                    <div className="l-sub">{x.zone} · {brickName(brickTypes, x.brickType)} · {x.workers.length} คน</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 120 }}>
                    <div className="progress-bar"><div className="fill" style={{ width: pct(x.area, x.expectedArea) + '%' }} /></div>
                  </div>
                  <span className="cell-muted text-mono" style={{ fontSize: 12 }}>{pct(x.area, x.expectedArea)}%</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => onOpenTask(x.id)}>ดู</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>ระบบล่าสุด</h3></div>
          <div className="card-body">
            <div className="setting-note">AI Brick Monitoring กำลังทำงานด้วยข้อมูลจริงจาก backend (server.js + yolo_service.py)</div>
            <div className="divider" /><div className="l-sub">สถานะ Server</div><div style={{ fontWeight: 600, marginTop: 5 }}>Online</div>
            <div className="divider" /><div className="l-sub">โหมดการจับภาพ</div><div style={{ fontWeight: 600, marginTop: 5 }}>ตามรอบ Snapshot ของแต่ละ Task</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-head">
          <h3>ไทม์แลปส์งานที่เสร็จแล้ว</h3>
          <p className="cell-muted" style={{ fontSize: 12, margin: 0 }}>ต่อภาพ snapshot ที่บันทึกทุก 1 นาที — ดาวน์โหลดเป็นวิดีโอ MP4 หรือ GIF</p>
        </div>
        <div className="card-body">
          <div id="homeTimelapses" className="gallery">
            {finishedTasks.length === 0 ? (
              <div className="empty-state"><Icon name="empty" /><div className="e-title">ยังไม่มีงานที่เสร็จ</div><div className="e-desc">ไทม์แลปส์จะขึ้นที่นี่หลัง Task เสร็จสิ้น</div></div>
            ) : finishedTasks.map((t) => (
              <div className="gallery-item" key={t.id}>
                {t.timelapseStatus === 'ready' ? (
                  <img
                    className="g-mock"
                    style={{ width: '100%', height: 110, objectFit: 'cover', display: 'block', background: '#161719' }}
                    src={api.timelapseUrl(t.id, { format: 'gif', inline: true })}
                    loading="lazy"
                    alt={`ไทม์แลปส์ ${t.name}`}
                  />
                ) : (
                  <div className="g-mock" style={{ height: 110, display: 'grid', placeItems: 'center', background: '#161719', color: '#a1a1a6', fontSize: 12, textAlign: 'center', padding: 8 }}>
                    {t.timelapseStatus === 'building' ? 'กำลังสร้างไทม์แลปส์...' : t.timelapseStatus === 'failed' ? 'สร้างไทม์แลปส์ไม่สำเร็จ' : 'ยังไม่มีไทม์แลปส์'}
                  </div>
                )}
                <div className="g-time">{t.name}</div>
                {t.timelapseStatus === 'ready' && (
                  <div style={{ padding: '0 8px 8px', display: 'flex', gap: 6 }}>
                    <a className="btn btn-secondary btn-sm" style={{ flex: 1 }} href={api.timelapseUrl(t.id, { format: 'mp4' })}>MP4</a>
                    <a className="btn btn-secondary btn-sm" style={{ flex: 1 }} href={api.timelapseUrl(t.id, { format: 'gif' })}>GIF</a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
