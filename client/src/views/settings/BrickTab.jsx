import { useEffect, useState } from 'react';
import Icon from '../../icons/Icon.jsx';
import { useToast } from '../../components/Toast.jsx';
import * as api from '../../api.js';

// Standard labour productivity from the project's reference table (report table 2.2: 1 ช่าง, ไม่มีผู้ช่วยผสมปูน)
export const STANDARD_PRESETS = [
  { label: 'ก่ออิฐมอญครึ่งแผ่น', min: 8, max: 12 },
  { label: 'ก่ออิฐบล็อกหนา 7 ซม. ไม่เซาะร่อง', min: 20, max: 25 },
  { label: 'ก่ออิฐมวลเบา 7.5 × 20 × 60 ซม.', min: 20, max: 25 },
];

const EMPTY_SIZE = { lengthCm: '', heightCm: '', thicknessCm: '' };
const toSize = (s) => (s ? { lengthCm: String(s.lengthCm), heightCm: String(s.heightCm), thicknessCm: s.thicknessCm ? String(s.thicknessCm) : '' } : { ...EMPTY_SIZE });
// same formula as productivity.js brickArea: length × height of the wall face
function areaOf(s) {
  const L = Number(s.lengthCm), H = Number(s.heightCm);
  return L > 0 && H > 0 ? Math.round((L * H) / 10000 * 1e6) / 1e6 : null;
}
const sizeBody = (s) => ({ lengthCm: Number(s.lengthCm), heightCm: Number(s.heightCm), thicknessCm: s.thicknessCm === '' ? null : Number(s.thicknessCm) });
const areaText = (a) => (a ? `${a.toLocaleString('th-TH', { maximumFractionDigits: 5 })} ตร.ม./ก้อน (${(1 / a).toLocaleString('th-TH', { maximumFractionDigits: 1 })} ก้อน/ตร.ม.)` : '—');

// ยาว × สูง × หนา (ซม.) inputs
function SizeFields({ value, onChange, onCommit }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const num = (k, ph, w = 64) => (
    <input type="number" min="0" step="any" className="input" style={{ width: w, display: 'inline-block' }} placeholder={ph}
      value={value[k]} onChange={set(k)} onBlur={onCommit} />
  );
  return (
    <span className="bt-size">
      {num('lengthCm', 'ยาว')} × {num('heightCm', 'สูง')} × {num('thicknessCm', 'หนา')} ซม.
    </span>
  );
}

/* One brick type: its size sets the area per brick; size / Class ID / P standard commit on blur. */
function BrickRow({ b, onSaved, onRemove }) {
  const toast = useToast();
  const [size, setSize] = useState(() => toSize(b.size));
  useEffect(() => { setSize(toSize(b.size)); }, [b.size]);

  async function save(patch, okText) {
    const { ok, data } = await api.updateBrickType(b.id, patch);
    if (ok) { await onSaved(); toast(okText, 'success'); } else toast(data?.message || 'อัปเดตไม่สำเร็จ');
  }
  function commitSize(next) {
    const s = next && next.lengthCm !== undefined ? next : size;
    if (!areaOf(s)) return; // wait until length and height are both filled in
    const same = b.size && Number(s.lengthCm) === b.size.lengthCm && Number(s.heightCm) === b.size.heightCm
      && (s.thicknessCm === '' ? null : Number(s.thicknessCm)) === (b.size.thicknessCm ?? null);
    if (!same) save({ size: sizeBody(s) }, `อัปเดตขนาดอิฐแล้ว — ${areaText(areaOf(s))}`);
  }
  function commitPStd(min, max) {
    const lo = min === '' || min === null ? null : Number(min), hi = max === '' || max === null ? null : Number(max);
    if ((lo !== null && !(lo > 0)) || (hi !== null && !(hi > 0))) { toast('P มาตรฐานต้องมากกว่า 0'); return; }
    if (lo !== null && hi !== null && hi < lo) { toast('ค่าสูงสุดต้องไม่น้อยกว่าค่าต่ำสุด'); return; }
    save({ standardProductivityMin: lo, standardProductivityMax: hi }, 'อัปเดต P มาตรฐานแล้ว');
  }
  const preview = areaOf(size);

  return (
    <div className="list-row bt-row">
      <div className="l-main">
        <div style={{ width: '100%' }}>
          <div className="l-name">{b.name}</div>
          <div className="l-sub bt-line">
            <b>ขนาดอิฐ:</b> <SizeFields value={size} onChange={setSize} onCommit={commitSize} />
          </div>
          <div className="l-sub bt-line">
            <b>พื้นที่ต่อก้อน:</b>{' '}
            {b.size || preview ? (
              <span className="bt-area" title="ยาว × สูง ของหน้าอิฐที่เห็นในผนัง">{areaText(preview || b.blocksPerSqm)}</span>
            ) : (
              <>
                <input type="number" min="0.0001" step="any" className="input" style={{ width: 100, display: 'inline-block' }}
                  defaultValue={b.blocksPerSqm ?? ''} key={`ratio-${b.id}-${b.blocksPerSqm}`}
                  onBlur={(e) => { const r = parseFloat(e.target.value); if (String(e.target.value) !== String(b.blocksPerSqm)) { if (!(r > 0)) toast('พื้นที่ต่อก้อนต้องมากกว่า 0'); else save({ blocksPerSqm: r }, 'อัปเดตพื้นที่ต่อก้อนแล้ว'); } }}
                /> ตร.ม./ก้อน <span className="cell-muted">(กรอกเอง — ใส่ขนาดอิฐด้านบนเพื่อให้ระบบคำนวณให้)</span>
              </>
            )}
          </div>
          <div className="l-sub bt-line">
            <b>P มาตรฐาน:</b>{' '}
            <input type="number" min="0.01" step="any" className="input" style={{ width: 70, display: 'inline-block' }}
              defaultValue={b.standardProductivityMin ?? ''} key={`pmin-${b.id}-${b.standardProductivityMin}`} placeholder="ต่ำสุด"
              onBlur={(e) => { if (String(e.target.value) !== String(b.standardProductivityMin ?? '')) commitPStd(e.target.value, b.standardProductivityMax ?? e.target.value); }} /> –{' '}
            <input type="number" min="0.01" step="any" className="input" style={{ width: 70, display: 'inline-block' }}
              defaultValue={b.standardProductivityMax ?? ''} key={`pmax-${b.id}-${b.standardProductivityMax}`} placeholder="สูงสุด"
              onBlur={(e) => { if (String(e.target.value) !== String(b.standardProductivityMax ?? '')) commitPStd(b.standardProductivityMin ?? e.target.value, e.target.value); }} /> ตร.ม./คน-วัน
            {b.standardProductivity ? <span className="cell-muted"> (ค่ากลาง {b.standardProductivity})</span> : null}{' '}
            <select className="select bt-preset" value="" title="ใช้ค่าจากตารางมาตรฐาน"
              onChange={(e) => { const p = STANDARD_PRESETS[Number(e.target.value)]; if (p) commitPStd(p.min, p.max); }}>
              <option value="">ใช้ค่าจากตาราง…</option>
              {STANDARD_PRESETS.map((p, i) => <option key={i} value={i}>{p.label} ({p.min}–{p.max})</option>)}
            </select>
            {' '}· Class ID:{' '}
            <input type="number" min="0" step="1" className="input" style={{ width: 96, display: 'inline-block' }}
              defaultValue={b.classId ?? ''} key={`classid-${b.id}-${b.classId}`} placeholder="ทุก class"
              onBlur={(e) => { if (String(e.target.value) !== String(b.classId ?? '')) save({ classId: e.target.value === '' ? null : parseInt(e.target.value, 10) }, 'อัปเดต Class ID แล้ว'); }} />
          </div>
        </div>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={() => onRemove(b.id)}><Icon name="trash" /></button>
    </div>
  );
}

export default function BrickTab({ brickTypes, reloadBrickTypes }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [size, setSize] = useState({ ...EMPTY_SIZE });
  const [classId, setClassId] = useState('');
  const [pMin, setPMin] = useState('');
  const [pMax, setPMax] = useState('');

  async function addBrickType() {
    if (!name.trim()) { toast('กรุณากรอกชื่อประเภทอิฐ'); return; }
    if (!areaOf(size)) { toast('กรุณากรอกขนาดอิฐ (ยาว × สูง)'); return; }
    try {
      const { ok, data } = await api.createBrickType({
        name: name.trim(), size: sizeBody(size), classId: classId === '' ? null : parseInt(classId, 10),
        standardProductivityMin: pMin === '' ? null : Number(pMin), standardProductivityMax: pMax === '' ? null : Number(pMax),
      });
      if (ok) {
        setName(''); setSize({ ...EMPTY_SIZE }); setClassId(''); setPMin(''); setPMax('');
        await reloadBrickTypes();
        toast('เพิ่มประเภทอิฐเรียบร้อยแล้ว', 'success');
      } else {
        toast(data.message || 'เพิ่มไม่สำเร็จ');
      }
    } catch (_) { toast('เชื่อมต่อ backend ไม่สำเร็จ'); }
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
            ใส่ <b>ขนาดอิฐ</b> ตามที่ก่อจริง (ยาว × สูง = ด้านที่เห็นหน้าผนัง, หนา = ความหนาผนัง) ระบบคำนวณ
            <b> พื้นที่ต่อก้อน = ยาว × สูง</b> ให้เอง แล้วใช้แปลงจำนวนก้อนที่ AI นับได้เป็นพื้นที่ (พื้นที่ = จำนวนก้อน × พื้นที่ต่อก้อน)
            — "P มาตรฐาน" ใส่เป็นช่วงต่ำสุด–สูงสุดตามตารางอ้างอิง — "Class ID" ใช้เมื่อโมเดลแยกหลาย class (เว้นว่าง = นับทุก class)
          </p>
          <div className="bt-add">
            <input className="input" placeholder="ชื่อประเภทอิฐ" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 220 }} />
            <SizeFields value={size} onChange={setSize} />
            <span className="bt-area">{areaText(areaOf(size))}</span>
          </div>
          <div className="bt-add">
            <select className="select" style={{ maxWidth: 260 }} value="" onChange={(e) => { const p = STANDARD_PRESETS[Number(e.target.value)]; if (p) { setPMin(String(p.min)); setPMax(String(p.max)); } }}>
              <option value="">P มาตรฐานจากตาราง…</option>
              {STANDARD_PRESETS.map((p, i) => <option key={i} value={i}>{p.label} ({p.min}–{p.max})</option>)}
            </select>
            <input type="number" min="0.01" step="any" className="input" style={{ maxWidth: 100 }} placeholder="P ต่ำสุด" value={pMin} onChange={(e) => setPMin(e.target.value)} />
            <input type="number" min="0.01" step="any" className="input" style={{ maxWidth: 100 }} placeholder="P สูงสุด" value={pMax} onChange={(e) => setPMax(e.target.value)} />
            <input type="number" min="0" step="1" className="input" style={{ maxWidth: 130 }} placeholder="Class ID (ถ้ามี)" value={classId} onChange={(e) => setClassId(e.target.value)} />
            <button className="btn btn-primary" onClick={addBrickType}>+ เพิ่ม</button>
          </div>
          <div className="divider" />
          <div id="brickListBody">
            {brickTypes.length === 0 ? (
              <div className="cell-muted" style={{ fontSize: 13 }}>ยังไม่มีประเภทอิฐ</div>
            ) : brickTypes.map((b) => <BrickRow key={b.id} b={b} onSaved={reloadBrickTypes} onRemove={removeBrickType} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
