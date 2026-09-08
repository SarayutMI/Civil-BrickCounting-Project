import { useState } from 'react';
import Icon from '../../icons/Icon.jsx';
import { useToast } from '../../components/Toast.jsx';
import * as api from '../../api.js';

/* Ported from app.js Brick Types settings panel. The ratio/classId cells
   are edited inline; they commit on blur (native `onchange` semantics),
   not on every keystroke, same as the original's onchange="..." inputs. */
export default function BrickTab({ brickTypes, reloadBrickTypes }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [ratio, setRatio] = useState('');
  const [classId, setClassId] = useState('');

  async function addBrickType() {
    if (!name.trim()) { toast('กรุณากรอกชื่อประเภทอิฐ'); return; }
    const ratioNum = parseFloat(ratio) || 12.5;
    const classIdVal = classId === '' ? null : parseInt(classId, 10);
    try {
      const { ok, data } = await api.createBrickType({ name: name.trim(), blocksPerSqm: ratioNum, classId: classIdVal });
      if (ok) {
        setName(''); setRatio(''); setClassId('');
        await reloadBrickTypes();
        toast('เพิ่มประเภทอิฐเรียบร้อยแล้ว', 'success');
      } else {
        toast(data.message || 'เพิ่มไม่สำเร็จ');
      }
    } catch (_) { toast('เชื่อมต่อ backend ไม่สำเร็จ'); }
  }

  async function updateBrickRatio(id, value) {
    const r = parseFloat(value);
    if (!r || r <= 0) { toast('จำนวนบล็อกต่อตารางเมตรต้องมากกว่า 0'); return; }
    const { ok } = await api.updateBrickType(id, { blocksPerSqm: r });
    if (ok) { await reloadBrickTypes(); toast('อัปเดตอัตราส่วนแล้ว', 'success'); }
    else toast('อัปเดตไม่สำเร็จ');
  }

  async function updateBrickClassId(id, value) {
    const c = value === '' ? null : parseInt(value, 10);
    const { ok } = await api.updateBrickType(id, { classId: c });
    if (ok) { await reloadBrickTypes(); toast('อัปเดต Class ID แล้ว', 'success'); }
    else toast('อัปเดตไม่สำเร็จ');
  }

  async function removeBrickType(id) {
    const ok = await api.deleteBrickType(id);
    if (ok) { await reloadBrickTypes(); toast('ลบประเภทอิฐแล้ว'); }
    else toast('ลบไม่สำเร็จ');
  }

  return (
    <div id="panel-brick" className="settings-panel active">
      <div className="card">
        <div className="card-head"><h3>Brick Types</h3></div>
        <div className="card-body">
          <p className="cell-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            กำหนดว่าอิฐแต่ละประเภท นับกี่ "บล็อก" เท่ากับพื้นที่ 1 ตารางเมตร (ใช้คำนวณพื้นที่จากผล AI detection อัตโนมัติ) — ถ้าโมเดล best.pt แยกหลาย class ใส่ "Class ID" เพื่อให้นับเฉพาะ class ที่ตรงกับอิฐประเภทนี้ (เว้นว่าง = นับทุก class ที่เจอ)
          </p>
          <div className="toolbar">
            <input className="input" placeholder="ชื่อประเภทอิฐ" value={name} onChange={(e) => setName(e.target.value)} />
            <input type="number" min="0.01" step="0.01" className="input" style={{ maxWidth: 160 }} placeholder="บล็อก/ตร.ม. เช่น 12.5" value={ratio} onChange={(e) => setRatio(e.target.value)} />
            <input type="number" min="0" step="1" className="input" style={{ maxWidth: 130 }} placeholder="Class ID (ถ้ามี)" value={classId} onChange={(e) => setClassId(e.target.value)} />
            <button className="btn btn-primary" onClick={addBrickType}>+ เพิ่ม</button>
          </div>
          <div className="divider" />
          <div id="brickListBody">
            {brickTypes.length === 0 ? (
              <div className="cell-muted" style={{ fontSize: 13 }}>ยังไม่มีประเภทอิฐ</div>
            ) : brickTypes.map((b) => (
              <div className="list-row" key={b.id}>
                <div className="l-main">
                  <div>
                    <div className="l-name">{b.name}</div>
                    <div className="l-sub">
                      <input
                        type="number" min="0.01" step="0.01" className="input" style={{ width: 110, display: 'inline-block' }}
                        defaultValue={b.blocksPerSqm ?? 12.5}
                        key={`ratio-${b.id}-${b.blocksPerSqm}`}
                        onBlur={(e) => { if (String(e.target.value) !== String(b.blocksPerSqm)) updateBrickRatio(b.id, e.target.value); }}
                      /> บล็อก / ตร.ม. ·
                      {' '}Class ID:{' '}
                      <input
                        type="number" min="0" step="1" className="input" style={{ width: 80, display: 'inline-block' }}
                        defaultValue={b.classId ?? ''}
                        key={`classid-${b.id}-${b.classId}`}
                        placeholder="ทุก class"
                        onBlur={(e) => { if (String(e.target.value) !== String(b.classId ?? '')) updateBrickClassId(b.id, e.target.value); }}
                      />
                    </div>
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => removeBrickType(b.id)}><Icon name="trash" /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
