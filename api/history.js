// ดึง/บันทึกข้อมูล "ประวัติการใช้ไฟ" (ค่าที่ใช้วาดกราฟรายชั่วโมง/รายวัน/สัดส่วนอุปกรณ์) ลงฐานข้อมูลจริง
// ใช้ Upstash Redis (ฟรี) เก็บเป็น JSON ก้อนเดียว แทนที่จะเก็บไว้ใน localStorage ของเบราว์เซอร์เครื่องเดียว
// ผลคือ: เปิดเว็บจากเครื่องไหน/มือถือเครื่องไหนก็เห็นกราฟเดียวกัน และข้อมูลไม่หายตอนล้าง cache

const HIST_KEY = 'energy_history_v1';
const EMPTY_HIST = { hourly: {}, daily: {}, deviceDaily: {}, budget: null };

module.exports = async (req, res) => {
  // อนุญาตให้เรียกจากหน้าเว็บ (ซึ่งอาจ host อยู่คนละโดเมนกับ Vercel function นี้) ได้
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { token } = req.query;

  // ใช้ TRIGGER_TOKEN ตัวเดียวกับที่ตั้งไว้สำหรับ geo-trigger.js กันคนอื่นมาอ่าน/แก้ข้อมูลของเรา
  if (!process.env.TRIGGER_TOKEN || token !== process.env.TRIGGER_TOKEN) {
    res.status(401).json({ error: 'invalid or missing token' });
    return;
  }

  // Vercel Marketplace (Upstash) เติมชื่อตัวแปรเป็น KV_REST_API_URL / KV_REST_API_TOKEN
  // เผื่อกรณีตั้งเองผ่าน upstash.com โดยตรง ก็รองรับชื่อ UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN ด้วย
  const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!REDIS_URL || !REDIS_TOKEN) {
    res.status(500).json({ error: 'KV_REST_API_URL / KV_REST_API_TOKEN (หรือ UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) ยังไม่ได้ตั้งค่าใน Environment Variables' });
    return;
  }

  try {
    // ---------- โหลดกราฟ ----------
    if (req.method === 'GET') {
      const r = await fetch(`${REDIS_URL}/get/${HIST_KEY}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
      });
      const data = await r.json();
      if (data.error) {
        res.status(500).json({ error: data.error });
        return;
      }
      const hist = data.result ? JSON.parse(data.result) : EMPTY_HIST;
      res.status(200).json(hist);
      return;
    }

    // ---------- บันทึกกราฟ ----------
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
      }
      const value = JSON.stringify(Object.assign({}, EMPTY_HIST, body || {}));

      // ส่งเป็นคำสั่ง SET แบบ array ไปที่ root path ของ Upstash REST API
      // (ปลอดภัยกว่าฝัง JSON ลงในส่วนของ URL โดยตรง เพราะมีอักขระพิเศษเยอะ)
      const r = await fetch(REDIS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['SET', HIST_KEY, value])
      });
      const result = await r.json();
      if (result.error) {
        res.status(500).json({ error: result.error });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'method not allowed, ใช้ GET หรือ POST เท่านั้น' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
