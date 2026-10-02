import { useState } from 'react';
import { useToast } from '../../components/Toast.jsx';
import { openReportPdf } from '../../reportPdf.js';

/* PDF / Word export of a report for the given tasks (all tasks, or one task on its own report page),
   plus an optional CSV of whatever the caller passes in `onCsv`. */
export default function ExportButtons({ tasks, workersMaster, currentUser, title, fileBase = 'civil-report', onCsv }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null); // 'pdf' | 'word' | null

  async function run(kind) {
    setBusy(kind);
    try {
      if (kind === 'pdf') {
        toast('กำลังเตรียมรายงาน PDF — เลือก "บันทึกเป็น PDF" ในหน้าต่างพิมพ์');
        await openReportPdf({ tasks, workersMaster, user: currentUser?.name, title });
      } else {
        toast('กำลังสร้างไฟล์ Word (รวมภาพ) อาจใช้เวลาสักครู่...');
        // the docx library is large — load it only when someone actually exports to Word
        const { downloadReportDocx } = await import('../../reportDocx.js');
        await downloadReportDocx({ tasks, workersMaster, user: currentUser?.name, title, filename: `${fileBase}-${new Date().toISOString().slice(0, 10)}.docx` });
        toast('ดาวน์โหลดไฟล์ Word แล้ว', 'success');
      }
    } catch (err) {
      toast(err.message || 'สร้างรายงานไม่สำเร็จ');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="export-btns">
      {onCsv && <button type="button" className="btn btn-secondary" onClick={onCsv}>CSV</button>}
      <button type="button" className="btn btn-secondary" onClick={() => run('word')} disabled={!!busy}>{busy === 'word' ? 'กำลังสร้าง...' : 'Word'}</button>
      <button type="button" className="btn btn-primary" onClick={() => run('pdf')} disabled={!!busy}>{busy === 'pdf' ? 'กำลังสร้าง...' : 'PDF'}</button>
    </div>
  );
}
