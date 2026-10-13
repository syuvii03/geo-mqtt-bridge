// ============================================================================
// geo-trigger.js — Version 2.0 (Vercel Serverless Function: Webhook Bridge)
// Smart Home MQTT Dashboard + Geofencing Automation (v2)
//
// รองรับคำสั่งจาก iOS Shortcuts / Android MacroDroid / Webhook (action=enter|exit)
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

  // รองรับทั้ง GET query, POST JSON body และ Authorization Bearer Header
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

  // แปลง action เป็นตัวพิมพ์เล็ก และรองรับ leave เป็น alias ของ exit
  const rawClean = (rawAction || '').toLowerCase().trim();
  const action = (rawClean === 'leave') ? 'exit' : rawClean;

  // 1. ตรวจสอบ Token
  if (!process.env.TRIGGER_TOKEN || token !== process.env.TRIGGER_TOKEN) {
    res.status(401).json({ error: 'invalid or missing token' });
    return;
  }

  // 2. ตรวจสอบ action
  if (action !== 'enter' && action !== 'exit') {
    res.status(400).json({ error: 'action must be "enter" or "exit" (or "leave")' });
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

  // 3. หาอุปกรณ์และคำสั่งที่ต้องส่ง
  const rules = await fetchRulesFromRedis();
  let source = 'fallback-device-ids';
  let targets = []; // Array of { id, on }

  if (rules) {
    const direction = (action === 'enter') ? 'enter' : 'leave';
    const desired = {};

    rules.forEach(r => {
      // ตรวจสอบ match ทิศทาง
      if (r && r.deviceId && (r.direction === direction || (direction === 'leave' && r.direction === 'exit'))) {
        desired[r.deviceId] = (r.action === 'on');
      }
    });

    targets = Object.keys(desired).map(id => ({ id, on: desired[id] }));
    if (targets.length > 0) source = 'synced-redis-rules';
  }

  // Fallback กรณีไม่มีกฎใน Redis
  if (targets.length === 0) {
    const defaultOn = (action === 'enter');
    const deviceIds = (process.env.DEVICE_IDS || 'aircon,light,fan,light2')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    targets = deviceIds.map(id => ({ id, on: defaultOn }));
    source = 'fallback-device-ids';
  }

  if (targets.length === 0) {
    res.status(200).json({ ok: true, action, source, devices: [], note: 'No matching devices or rules' });
    return;
  }

  // 4. เชื่อมต่อ MQTT Broker และ Publish
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
    // ส่งคำสั่งทุกตัวด้วย QoS 1
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
