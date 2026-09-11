// ============================================================================
// devices-config.js
// ไฟล์นี้ถูก include โดยทั้ง index.html และ geo-settings.html
// เก็บ "รายชื่ออุปกรณ์" และ "กฎเปิด/ปิดอุปกรณ์ตามระยะทาง" ไว้ที่เดียว
// เพื่อไม่ให้สองหน้าเว็บมีรายชื่ออุปกรณ์ไม่ตรงกัน (ต้นเหตุของบั๊ก "ไฟนอกบ้าน" เดิม)
//
// ⚠️ ถ้าเพิ่ม/ลบ/เปลี่ยนชื่ออุปกรณ์ในโค้ด ESP32 (esp32_mqtt.ino) ต้องแก้ตรงนี้ให้ตรงกันด้วย
//    key ของแต่ละอุปกรณ์ (เช่น "aircon", "light") ต้องตรงกับ dev.id ใน esp32_mqtt.ino เป๊ะๆ
// ============================================================================

// ชื่อแสดงผลของแต่ละอุปกรณ์ (key ต้องตรงกับ id ใน esp32_mqtt.ino)
const DEVICE_NAMES = {
  aircon: "แอร์",
  light: "ไฟในบ้าน",
  light2: "ไฟนอกบ้าน",
  fan: "พัดลม",
  plug: "ปลั๊กไฟทั่วไป"
};

// key ที่ใช้เก็บกฎอัตโนมัติใน localStorage (ทั้งสองหน้าเว็บใช้ key เดียวกัน)
const GEO_RULES_KEY = "mqtt_dashboard_geo_rules";

// กฎเริ่มต้น (ใช้ครั้งแรกที่ยังไม่เคยตั้งค่าอะไรเลย) — จำลองพฤติกรรมฉากอัตโนมัติเดิม:
// ออกเกิน 20 ม. -> ปิดไฟในบ้าน/พัดลม/แอร์, เปิดไฟนอกบ้าน
// เข้ามาในระยะ 20 ม. -> เปิดไฟในบ้าน/พัดลม, ปิดไฟนอกบ้าน
// เข้ามาในระยะ 100 ม. -> เปิดแอร์ล่วงหน้า
const DEFAULT_GEO_RULES = [
  { id: "default-1", deviceId: "light",  distanceM: 20,  direction: "leave", action: "off" },
  { id: "default-2", deviceId: "light2", distanceM: 20,  direction: "leave", action: "on"  },
  { id: "default-3", deviceId: "fan",    distanceM: 20,  direction: "leave", action: "off" },
  { id: "default-4", deviceId: "aircon", distanceM: 20,  direction: "leave", action: "off" },
  { id: "default-5", deviceId: "fan",    distanceM: 20,  direction: "enter", action: "on"  },
  { id: "default-6", deviceId: "light",  distanceM: 20,  direction: "enter", action: "on"  },
  { id: "default-7", deviceId: "light2", distanceM: 20,  direction: "enter", action: "off" },
  { id: "default-8", deviceId: "aircon", distanceM: 100, direction: "enter", action: "on"  }
];

// สร้าง id ใหม่ให้แต่ละกฎ (ใช้ตอนเพิ่มกฎในหน้าตั้งค่า)
function genRuleId() {
  return "rule-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
}

// อ่านกฎปัจจุบันจาก localStorage; ถ้ายังไม่มี ให้ใช้กฎเริ่มต้นแล้วบันทึกไว้เลย
// (ทั้งสองหน้าเว็บเรียกฟังก์ชันนี้ตอนโหลดหน้า เพื่อให้เห็นกฎชุดเดียวกันเสมอ)
function loadGeoRulesFromStorage() {
  const saved = localStorage.getItem(GEO_RULES_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) { /* ข้อมูลเสีย ใช้ค่าเริ่มต้นแทน */ }
  }
  const seeded = DEFAULT_GEO_RULES.map(r => ({ ...r }));
  localStorage.setItem(GEO_RULES_KEY, JSON.stringify(seeded));
  return seeded;
}

function saveGeoRulesToStorage(rules) {
  localStorage.setItem(GEO_RULES_KEY, JSON.stringify(rules));
}

// ============================================================================
// ซิงค์กฎกับฐานข้อมูลกลาง (Upstash Redis ผ่าน Vercel Function api/rules.js
// ในโปรเจกต์ geo-mqtt-bridge เดียวกับที่ใช้เก็บ "ประวัติการใช้ไฟ" อยู่แล้ว)
//
// ทำแบบนี้เพื่อให้ระบบ IFTTT พื้นหลัง (geo-trigger.js) อ่านกฎ "ชุดเดียวกัน" กับที่ตั้งไว้
// ในหน้าเว็บนี้ได้ — แก้กฎที่หน้า geo-settings.html ที่เดียว มีผลทั้งฝั่ง GPS ในเบราว์เซอร์
// และฝั่ง IFTTT พื้นหลังพร้อมกัน (ไม่ต้องตั้งซ้ำสองที่เหมือนเดิม)
//
// apiUrl/apiToken ใช้ค่าเดียวกับ histUrl/histToken ที่ตั้งไว้ใน DEFAULT_CONFIG ของ index.html
// เพราะเป็น Vercel project เดียวกัน (geo-mqtt-bridge) — ถ้าไม่กรอก ระบบจะยังทำงานได้ปกติ
// แค่ไม่ซิงค์ขึ้นฐานข้อมูล (ใช้ localStorage ของเครื่องนั้นๆ ต่อไปเหมือนเดิม)
// ============================================================================

function rulesEndpoint(apiUrl, apiToken) {
  return `${String(apiUrl || "").replace(/\/$/, '')}/api/rules?token=${encodeURIComponent(apiToken || "")}`;
}

// คืนค่า array ของกฎจากฐานข้อมูล, หรือ null ถ้ายังไม่ได้ตั้งค่า apiUrl/apiToken หรือโหลดไม่สำเร็จ
async function fetchRulesFromBridge(apiUrl, apiToken) {
  if (!apiUrl || !apiToken) return null;
  const r = await fetch(rulesEndpoint(apiUrl, apiToken));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return Array.isArray(data.rules) ? data.rules : null;
}

// ส่งกฎชุดปัจจุบันขึ้นฐานข้อมูล; คืนค่า true ถ้าสำเร็จ, false ถ้ายังไม่ได้ตั้งค่า apiUrl/apiToken
async function pushRulesToBridge(apiUrl, apiToken, rules) {
  if (!apiUrl || !apiToken) return false;
  const r = await fetch(rulesEndpoint(apiUrl, apiToken), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules })
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return true;
}

// ให้ไฟล์นี้ require() ได้จากฝั่ง Node เช่นกัน (เผื่อใช้ในอนาคต) โดยไม่กระทบการใช้งานแบบ <script> ในเบราว์เซอร์
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEVICE_NAMES, GEO_RULES_KEY, DEFAULT_GEO_RULES, genRuleId,
    loadGeoRulesFromStorage, saveGeoRulesToStorage,
    rulesEndpoint, fetchRulesFromBridge, pushRulesToBridge
  };
}
