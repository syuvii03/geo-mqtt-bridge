// ตัวกลางแปลง HTTP request (จาก IFTTT Webhook) ให้เป็นคำสั่ง MQTT publish
// ใช้งานร่วมกับ Vercel Serverless Functions (ฟรี ไม่ต้องมีเซิร์ฟเวอร์ของตัวเอง)
//
// อัปเดต: ตอนนี้จะพยายามอ่าน "กฎเปิด/ปิดตามระยะ" ชุดเดียวกับที่ตั้งไว้ในหน้าเว็บ (geo-settings.html)
// จากฐานข้อมูล Upstash Redis ก่อนเป็นอันดับแรก (ผ่าน key เดียวกับที่ api/rules.js ใช้)
// ต้องกด "บันทึกกฎทั้งหมด" ที่หน้า geo-settings.html อย่างน้อย 1 ครั้งเพื่อซิงค์กฎขึ้นฐานข้อมูลก่อน
// ถ้ายังไม่เคยซิงค์กฎ หรือยังไม่ได้ตั้งค่า UPSTASH_REDIS_REST_URL/TOKEN จะ fallback กลับไปใช้
// พฤติกรรมเดิม (เปิด/ปิดอุปกรณ์ตาม DEVICE_IDS แบบง่ายๆ ทุกตัวพร้อมกัน) เหมือนก่อนหน้านี้ทุกประการ
//
// ⚠️ ข้อจำกัดสำคัญที่ควรรู้: IFTTT ส่งมาแค่ "เข้าเขต" (enter) หรือ "ออกเขต" (exit) แบบเดียว
// (รัศมีเดียวที่ตั้งไว้ในแอป IFTTT) ไม่มีค่าระยะทางต่อเนื่องแบบที่หน้าเว็บใช้ตอนเปิด GPS ในเบราว์เซอร์
// ดังนั้นเมื่อทำงานผ่าน IFTTT ระบบจะรวมกฎ "ทุกข้อ" ที่ตรงทิศทางเดียวกัน (เข้า/ออก) มาใช้พร้อมกันทั้งหมด
// โดยไม่สนใจว่าแต่ละกฎตั้งระยะไว้กี่เมตร (เช่น กฎ "แอร์เปิดตอนเข้ามาในระยะ 100 ม." กับ
// "ไฟในบ้านเปิดตอนเข้ามาในระยะ 20 ม." จะเปิดพร้อมกันทันทีที่ข้ามเขตของ IFTTT ไม่ทยอยเปิดตามระยะจริง
// เหมือนตอนใช้ GPS ในเบราว์เซอร์) — ถ้าอยากได้พฤติกรรมแบบทยอยตามระยะจริง ต้องเปิดแอปเว็บไว้ให้ GPS ทำงานแทน

const mqtt = require('mqtt');

const RULES_KEY = 'geo_dashboard_rules_v1'; // ต้องตรงกับ key ที่ api/rules.js ใช้เก็บกฎ

// พยายามอ่านกฎล่าสุดจาก Upstash Redis โดยตรง (ไม่ผ่าน api/rules.js เพื่อลดจำนวน hop)
// คืนค่า null ถ้าอ่านไม่ได้ / ยังไม่ได้ตั้งค่า / ยังไม่มีกฎที่ซิงค์ไว้เลย (ให้ผู้เรียกไป fallback เอง)
async function fetchRulesFromRedis() {
  const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
  const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const r = await fetch(`${REDIS_URL}/get/${RULES_KEY}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const data = await r.json();
    if (!data || !data.result) return null;
    const parsed = JSON.parse(data.result);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch (e) {
    return null; // อ่านไม่สำเร็จ ปล่อยให้ fallback ไปใช้พฤติกรรมเดิมแทน ไม่ทำให้ request ทั้งหมดพัง
  }
}

module.exports = async (req, res) => {
  const { token, action } = req.query;

  // 1) ตรวจสอบ token กันคนอื่นยิง URL มาสั่งเปิด/ปิดมั่ว
  if (!process.env.TRIGGER_TOKEN || token !== process.env.TRIGGER_TOKEN) {
    res.status(401).json({ error: 'invalid or missing token' });
    return;
  }

  // 2) action ต้องเป็น enter (เข้าเขต) หรือ exit (ออกเขต) เท่านั้น
  if (action !== 'enter' && action !== 'exit') {
    res.status(400).json({ error: 'action must be "enter" or "exit"' });
    return;
  }

  const prefix = process.env.MQTT_PREFIX || 'myhome';
  const host = process.env.MQTT_HOST;
  const port = process.env.MQTT_PORT || '8884';
  const url = `wss://${host}:${port}/mqtt`;

  if (!host || !process.env.MQTT_USER || !process.env.MQTT_PASS) {
    res.status(500).json({ error: 'MQTT_HOST / MQTT_USER / MQTT_PASS ยังไม่ได้ตั้งค่าใน Environment Variables' });
    return;
  }

  // 3) หาว่าควรสั่งอุปกรณ์ไหนเป็นสถานะอะไรบ้าง — ลองใช้กฎจากฐานข้อมูลก่อน ถ้าไม่มีค่อย fallback ไปพฤติกรรมเดิม
  const rules = await fetchRulesFromRedis();
  let source, targets; // targets: [{ id, on }]

  if (rules) {
    const direction = action === 'enter' ? 'enter' : 'leave';
    const desired = {}; // { [deviceId]: boolean } — ถ้ามีหลายกฎชนกันที่อุปกรณ์เดียวกัน กฎหลังสุดในลิสต์จะทับ
    rules
      .filter(r => r && r.direction === direction && r.deviceId)
      .forEach(r => { desired[r.deviceId] = r.action === 'on'; });
    targets = Object.keys(desired).map(id => ({ id, on: desired[id] }));
    source = 'synced-rules';
  } else {
    // Fallback เดิม: สั่งอุปกรณ์ตาม DEVICE_IDS ทั้งหมดเป็นสถานะเดียวกัน
    // (ยังไม่เคยกด "บันทึกกฎทั้งหมด" ที่ geo-settings.html เพื่อซิงค์ขึ้นฐานข้อมูล หรือยังไม่ได้ตั้งค่า Upstash)
    const payloadOn = action === 'enter';
    const deviceIds = (process.env.DEVICE_IDS || 'aircon,light,fan')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    targets = deviceIds.map(id => ({ id, on: payloadOn }));
    source = 'fallback-device-ids';
  }

  if (targets.length === 0) {
    res.status(200).json({ ok: true, action, source, devices: [], note: 'ไม่มีกฎ/อุปกรณ์ที่ตรงเงื่อนไขนี้ ไม่ได้สั่งอะไร' });
    return;
  }

  let responded = false;
  const client = mqtt.connect(url, {
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
    connectTimeout: 8000,
    reconnectPeriod: 0, // ไม่ต้อง auto-reconnect เพราะ function นี้ทำงานครั้งเดียวจบ
  });

  // กันฟังก์ชันค้างถ้าเชื่อมต่อไม่สำเร็จ
  const safetyTimeout = setTimeout(() => {
    if (!responded) {
      responded = true;
      client.end(true);
      res.status(504).json({ error: 'เชื่อมต่อ MQTT ไม่สำเร็จภายในเวลาที่กำหนด' });
    }
  }, 9000);

  client.on('connect', () => {
    targets.forEach(t => client.publish(`${prefix}/${t.id}/set`, t.on ? 'ON' : 'OFF'));
    // หน่วงเล็กน้อยให้แน่ใจว่าข้อความถูกส่งออกไปจริงก่อนตัดการเชื่อมต่อ
    setTimeout(() => {
      if (!responded) {
        responded = true;
        clearTimeout(safetyTimeout);
        client.end();
        res.status(200).json({ ok: true, action, source, devices: targets });
      }
    }, 800);
  });

  client.on('error', (err) => {
    if (!responded) {
      responded = true;
      clearTimeout(safetyTimeout);
      client.end(true);
      res.status(500).json({ error: err.message });
    }
  });
};
