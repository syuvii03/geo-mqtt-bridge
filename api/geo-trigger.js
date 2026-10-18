// ============================================================================
// geo-trigger.js — Version 2.1 (Multi-Zone & Pre-Cool Automation Bridge)
// Smart Home MQTT Dashboard + Geofencing Automation
// ============================================================================

const mqtt = require('mqtt');

const RULES_KEY = 'geo_dashboard_rules_v1';

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
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  let token = req.query?.token;
  let rawAction = req.query?.action;

  if (req.body) {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
    token = token || body.token;
    rawAction = rawAction || body.action;
  }

  const authHeader = req.headers?.authorization;
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  const action = (rawAction || '').toLowerCase().trim();

  // 1. ตรวจสอบ Token
  if (!process.env.TRIGGER_TOKEN || token !== process.env.TRIGGER_TOKEN) {
    res.status(401).json({ error: 'invalid or missing token' });
    return;
  }

  const prefix = process.env.MQTT_PREFIX || 'myhome';
  const host = process.env.MQTT_HOST;
  const port = process.env.MQTT_PORT || '8884';
  const url = `wss://${host}:${port}/mqtt`;

  if (!host || !process.env.MQTT_USER || !process.env.MQTT_PASS) {
    res.status(500).json({ error: 'MQTT_HOST, MQTT_USER or MQTT_PASS not set in environment variables' });
    return;
  }

  // 2. กำหนดอุปกรณ์และสถานะเปิด/ปิดตามเงื่อนไขที่คุณต้องการ
  let source = 'custom-scenario';
  let targets = [];

  if (action === 'precool' || action === 'aircon_on') {
    // โหมด 500 เมตร: เปิดเฉพาะแอร์ตัวเดียวล่วงหน้า
    targets = [
      { id: 'aircon', on: true }
    ];
    source = 'precool-500m';
  } else if (action === 'enter' || action === 'arrive') {
    // โหมดถึงบ้าน (100 เมตร): เปิดไฟในบ้าน + พัดลม แต่ "ปิดไฟหน้าบ้าน"
    targets = [
      { id: 'light',  on: true },   // ไฟในบ้าน = เปิด
      { id: 'fan',    on: true },   // พัดลม = เปิด
      { id: 'light2', on: false }   // ไฟหน้าบ้าน = ปิด
    ];
    source = 'arrive-home';
  } else if (action === 'exit' || action === 'leave') {
    // โหมดออกจากบ้าน: ปิดไฟในบ้าน + พัดลม + แอร์ แต่ "เปิดไฟหน้าบ้าน"
    targets = [
      { id: 'light',  on: false },  // ไฟในบ้าน = ปิด
      { id: 'fan',    on: false },  // พัดลม = ปิด
      { id: 'aircon', on: false },  // แอร์ = ปิด
      { id: 'light2', on: true }    // ไฟหน้าบ้าน = เปิด
    ];
    source = 'leave-home';
  } else {
    res.status(400).json({ error: 'action must be "precool", "enter", or "exit"' });
    return;
  }

  // 3. เชื่อมต่อ MQTT Broker และ Publish คำสั่ง
  let responded = false;
  const clientId = `bridge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  const client = mqtt.connect(url, {
    username: process.env.MQTT_USER,
    password: process.env.MQTT_PASS,
    clientId,
    connectTimeout: 8000,
    reconnectPeriod: 0
  });

  const safetyTimer = setTimeout(() => {
    if (!responded) {
      responded = true;
      try { client.end(true); } catch (e) {}
      res.status(504).json({ error: 'MQTT connection timeout (8s)' });
    }
  }, 8500);

  client.on('connect', () => {
    const promises = targets.map(t => {
      return new Promise((resolve) => {
        client.publish(`${prefix}/${t.id}/set`, t.on ? 'ON' : 'OFF', { qos: 1 }, (err) => {
          resolve({ id: t.id, on: t.on, success: !err });
        });
      });
    });

    Promise.all(promises).then((results) => {
      setTimeout(() => {
        if (!responded) {
          responded = true;
          clearTimeout(safetyTimer);
          try { client.end(); } catch (e) {}
          res.status(200).json({
            ok: true,
            action,
            source,
            count: results.length,
            results,
            timestamp: new Date().toISOString()
          });
        }
      }, 500);
    });
  });

  client.on('error', (err) => {
    if (!responded) {
      responded = true;
      clearTimeout(safetyTimer);
      try { client.end(true); } catch (e) {}
      res.status(500).json({ error: err.message });
    }
  });
};
