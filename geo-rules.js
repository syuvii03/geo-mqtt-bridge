// ==========================================================================
// geo-rules.js — กฎเปิด/ปิดอุปกรณ์ตามระยะห่างจากบ้าน
// ไฟล์นี้ใช้ร่วมกันระหว่าง index.html (แดชบอร์ดหลัก) และ geo-settings.html (หน้าตั้งค่ากฎ)
// ต้องวางไฟล์นี้ไว้โฟลเดอร์เดียวกับอีกสองไฟล์ และต้องเปิดทั้งสองหน้าจาก origin เดียวกัน
// (โดเมน/พาธเดียวกัน เช่น GitHub Pages เดียวกัน) กฎที่บันทึกไว้ถึงจะแชร์กันผ่าน localStorage ได้
// ==========================================================================

const GEO_RULES_KEY = "mqtt_dashboard_geo_rules";

// รายชื่ออุปกรณ์ที่มีอยู่จริงในบอร์ด — ต้องตรงกับ id ใน devices[] ของ esp32_mqtt.ino เป๊ะๆ
// ถ้าต่ออุปกรณ์เพิ่มในบอร์ด ให้เพิ่ม id/label ที่นี่ด้วย ไม่งั้นจะเลือกจากหน้าตั้งค่าไม่ได้
const GEO_DEVICE_LIST = [
  { id: "aircon", label: "แอร์" },
  { id: "light", label: "ไฟในบ้าน" },
  { id: "light2", label: "ไฟหน้าบ้าน" },
  { id: "fan", label: "พัดลม" },
  { id: "plug", label: "ปลั๊กไฟทั่วไป" },
];

function geoDeviceLabel(id) {
  const found = GEO_DEVICE_LIST.find((d) => d.id === id);
  return found ? found.label : id;
}

// ค่าเริ่มต้น ใช้ตอนยังไม่เคยตั้งค่าอะไรเลย (ตรงกับที่คุยกันไว้ตอนแรก)
function defaultGeoRules() {
  return [
    {
      id: "home-20m",
      distance: 20,
      enter: [
        { device: "fan", state: true },
        { device: "light", state: true },
        { device: "light2", state: false },
      ],
      exit: [
        { device: "light", state: false },
        { device: "light2", state: true },
        { device: "fan", state: false },
        { device: "aircon", state: false },
      ],
    },
    {
      id: "precool-100m",
      distance: 100,
      enter: [{ device: "aircon", state: true }],
      exit: [],
    },
  ];
}

// โหลดกฎจาก localStorage — คืนค่าเริ่มต้นถ้ายังไม่เคยตั้งค่า หรือข้อมูลเสีย
function loadGeoRules() {
  try {
    const raw = localStorage.getItem(GEO_RULES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return defaultGeoRules();
}

function saveGeoRules(rules) {
  localStorage.setItem(GEO_RULES_KEY, JSON.stringify(rules));
}
