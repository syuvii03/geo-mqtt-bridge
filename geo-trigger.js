// ตัวกลางแปลง HTTP request (จาก IFTTT Webhook) ให้เป็นคำสั่ง MQTT publish
// ใช้งานร่วมกับ Vercel Serverless Functions (ฟรี ไม่ต้องมีเซิร์ฟเวอร์ของตัวเอง)

const mqtt = require('mqtt');

module.exports = async (req, res) => {
  const { token, action } = req.query;

  // 1) ตรวจสอบ token กันคนอื่นยิง URL มาสั่งเปิด/ปิดมั่ว
  if (!process.env.TRIGGER_TOKEN || token !== process.env.TRIGGER_TOKEN) {
    res.status(401).json({ error: 'invalid or missing token' });
    return;
  }

  // 2) action ต้องเป็น enter (เข้าเขต -> เปิด) หรือ exit (ออกเขต -> ปิด) เท่านั้น
  if (action !== 'enter' && action !== 'exit') {
    res.status(400).json({ error: 'action must be "enter" or "exit"' });
    return;
  }

  const payload = action === 'enter' ? 'ON' : 'OFF';
  const prefix = process.env.MQTT_PREFIX || 'myhome';
  // รายชื่ออุปกรณ์ที่จะสั่งพร้อมกัน คั่นด้วย comma ใน env var DEVICE_IDS
  // เช่น DEVICE_IDS=aircon,light,fan
  const deviceIds = (process.env.DEVICE_IDS || 'aircon,light,fan')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const host = process.env.MQTT_HOST;
  const port = process.env.MQTT_PORT || '8884';
  const url = `wss://${host}:${port}/mqtt`;

  if (!host || !process.env.MQTT_USER || !process.env.MQTT_PASS) {
    res.status(500).json({ error: 'MQTT_HOST / MQTT_USER / MQTT_PASS ยังไม่ได้ตั้งค่าใน Environment Variables' });
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
    deviceIds.forEach(id => client.publish(`${prefix}/${id}/set`, payload));
    // หน่วงเล็กน้อยให้แน่ใจว่าข้อความถูกส่งออกไปจริงก่อนตัดการเชื่อมต่อ
    setTimeout(() => {
      if (!responded) {
        responded = true;
        clearTimeout(safetyTimeout);
        client.end();
        res.status(200).json({ ok: true, action, payload, devices: deviceIds });
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
