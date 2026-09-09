# Geo → MQTT Bridge (สำหรับ IFTTT Webhooks)

ตัวกลางเล็กๆ ที่รับ HTTP request จาก IFTTT แล้วแปลงเป็นคำสั่ง MQTT
ไปสั่งเปิด/ปิดอุปกรณ์ผ่าน HiveMQ Cloud (หรือ broker อื่นที่รองรับ WSS)

ไม่ต้องมีเซิร์ฟเวอร์ของตัวเอง — รันบน Vercel (ฟรี)

## ขั้นตอน Deploy

1. สร้างบัญชี GitHub (ถ้ายังไม่มี) แล้วสร้าง repo ใหม่ ชื่ออะไรก็ได้ เช่น `geo-mqtt-bridge`
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ (`api/geo-trigger.js`, `package.json`) ขึ้น repo นั้น
3. ไปที่ https://vercel.com สมัคร/ล็อกอินด้วยบัญชี GitHub
4. กด "Add New..." → "Project" → เลือก repo ที่เพิ่งสร้าง → กด Deploy (ไม่ต้องแก้ค่าอะไร ปล่อย default)
5. หลัง deploy เสร็จ เข้าไปที่ Project → Settings → Environment Variables แล้วเพิ่มตัวแปรต่อไปนี้:

   | Key            | ตัวอย่างค่า                              |
   |----------------|-------------------------------------------|
   | MQTT_HOST      | a130eedbb798414f983f14f78493xxxx.s1.eu.hivemq.cloud |
   | MQTT_PORT      | 8884                                       |
   | MQTT_USER      | esp32                                      |
   | MQTT_PASS      | (รหัสผ่านเดียวกับที่ใช้ในหน้าเว็บ)         |
   | MQTT_PREFIX    | myhome                                     |
   | DEVICE_IDS     | aircon,light,fan                           |
   | TRIGGER_TOKEN  | (ตั้งรหัสลับยาวๆ เดาไม่ได้ เช่น สุ่มจาก https://randomkeygen.com) |

6. กด Save แล้วไปที่แท็บ Deployments กด "Redeploy" อีกครั้งให้ค่า Environment Variables มีผล
7. จะได้ URL ของฟังก์ชันเป็น:
   `https://<ชื่อโปรเจกต์ของคุณ>.vercel.app/api/geo-trigger`

## ทดสอบก่อนต่อ IFTTT

เปิดเบราว์เซอร์ แล้วพิมพ์ URL (ใส่ token ให้ตรงกับที่ตั้งไว้):

```
https://<โปรเจกต์>.vercel.app/api/geo-trigger?token=รหัสลับของคุณ&action=enter
```

ถ้าสำเร็จจะเห็น JSON แบบ `{"ok":true,"action":"enter",...}` และอุปกรณ์ในบ้านต้องติดจริง
ลองเปลี่ยน `action=exit` เพื่อทดสอบปิด

## ตั้งค่า IFTTT

1. ติดตั้งแอป IFTTT บนมือถือ แล้วอนุญาต Location permission แบบ "Always/ตลอดเวลา" (สำคัญ ถ้าให้แค่ "ใช้แอปเท่านั้น" จะไม่ทำงานตอนแอปปิด)
2. สร้าง Applet ที่ 1 (เข้าเขต → เปิด):
   - **If:** Location → "You enter an area" → ปักหมุดตำแหน่งบ้าน ตั้งรัศมี (แนะนำ 100-150 เมตร)
   - **Then:** Webhooks → "Make a web request"
     - URL: `https://<โปรเจกต์>.vercel.app/api/geo-trigger?token=รหัสลับของคุณ&action=enter`
     - Method: GET
3. สร้าง Applet ที่ 2 (ออกเขต → ปิด): เหมือนข้อ 2 แต่ใช้ "You exit an area" และ `action=exit`
4. ลองเดิน/ขับรถออกนอกเขตแล้วกลับเข้ามาดูผลจริง (ครั้งแรกอาจหน่วงสักครู่ เพราะ IFTTT ตรวจจับตำแหน่งพื้นหลังไม่ได้เรียลไทม์ 100% ปกติหน่วง 1-5 นาที)

## หมายเหตุด้านความปลอดภัย

- TRIGGER_TOKEN ป้องกันไม่ให้คนอื่นที่เดา URL ได้มาสั่งเปิด/ปิดอุปกรณ์บ้านคุณมั่ว ตั้งให้ยาวและสุ่มพอ อย่าใช้คำง่ายๆ
- อย่าแชร์ URL ที่มี token ให้คนอื่น หรือโพสต์ในที่สาธารณะ
