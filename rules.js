// เก็บ/อ่าน "กฎเปิด/ปิดอุปกรณ์ตามระยะ" (geo rules) ไว้ในฐานข้อมูลกลาง (Upstash Redis)
// เพื่อให้หน้าเว็บ (geo-settings.html / index.html) และระบบ IFTTT พื้นหลัง (geo-trigger.js)
// ใช้กฎ "ชุดเดียวกัน" เสมอ — แก้กฎที่หน้า geo-settings.html ที่เดียวพอ ไม่ต้องตั้งซ้ำสองระบบ
//
// ใช้ Environment Variables ชุดเดียวกับ api/history.js อยู่แล้ว (ไม่ต้องเพิ่มตัวแปรใหม่):
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, TRIGGER_TOKEN

const RULES_KEY = 'geo_dashboard_rules_v1'; // ต้องตรงกับ key ที่ geo-trigger.js อ่าน

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

  // ใช้ TRIGGER_TOKEN ตัวเดียวกับ geo-trigger.js / history.js กันคนอื่นมาอ่าน/แก้กฎของเรา
  if (!process.env.TRIGGER_TOKEN || token !== process.env.TRIGGER_TOKEN) {
    res.status(401).json({ error: 'invalid or missing token' });
    return;
  }

  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!REDIS_URL || !REDIS_TOKEN) {
    res.status(500).json({ error: 'UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN ยังไม่ได้ตั้งค่าใน Environment Variables' });
    return;
  }

  try {
    // ---------- โหลดกฎ ----------
    if (req.method === 'GET') {
      const r = await fetch(`${REDIS_URL}/get/${RULES_KEY}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
      });
      const data = await r.json();
      if (data.error) {
        res.status(500).json({ error: data.error });
        return;
      }
      const rules = data.result ? JSON.parse(data.result) : [];
      res.status(200).json({ rules: Array.isArray(rules) ? rules : [] });
      return;
    }

    // ---------- บันทึกกฎ ----------
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
      }
      const rulesIn = Array.isArray(body) ? body : (Array.isArray(body && body.rules) ? body.rules : null);
      if (!rulesIn) {
        res.status(400).json({ error: 'body ต้องเป็น array ของกฎ หรือ { rules: [...] }' });
        return;
      }

      // ตรวจสอบคร่าวๆ ว่าแต่ละกฎมีฟิลด์ที่จำเป็นครบและถูกต้อง กันข้อมูลขยะเข้าฐานข้อมูล
      // (ต้องคุ้นตากับรูปแบบกฎใน devices-config.js: { id, deviceId, distanceM, direction, action })
      const clean = rulesIn.filter(r => r && typeof r.deviceId === 'string' &&
        (r.direction === 'enter' || r.direction === 'leave') &&
        (r.action === 'on' || r.action === 'off') &&
        Number(r.distanceM) > 0
      ).map(r => ({
        id: String(r.id || ('rule-' + Date.now() + '-' + Math.floor(Math.random() * 100000))),
        deviceId: r.deviceId,
        distanceM: Math.round(Number(r.distanceM)),
        direction: r.direction,
        action: r.action
      }));

      const value = JSON.stringify(clean);
      // ส่งเป็นคำสั่ง SET แบบ array ไปที่ root path ของ Upstash REST API (เหมือน api/history.js)
      const r = await fetch(REDIS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(['SET', RULES_KEY, value])
      });
      const result = await r.json();
      if (result.error) {
        res.status(500).json({ error: result.error });
        return;
      }
      res.status(200).json({ ok: true, rules: clean });
      return;
    }

    res.status(405).json({ error: 'method not allowed, ใช้ GET หรือ POST เท่านั้น' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
