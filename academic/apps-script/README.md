# คลังผลงานวิชาการ รพ.สวี — วิธีอัปเดต Backend (Apps Script)

หน้าเว็บ `academic/index.html` และ `academic/admin.html` เวอร์ชันนี้ต้องใช้คู่กับ `Code.gs` ในโฟลเดอร์นี้
ใช้ Google Sheet "มหกรรมวิชาการ" เดิมได้เลย ระบบจะเพิ่มชีต (Calls, Submissions, Departments) และคอลัมน์ใหม่ให้เอง ข้อมูลเดิมไม่หาย

## ขั้นตอน (ทำครั้งเดียว ประมาณ 5 นาที)

1. เปิดโปรเจ็กต์ Apps Script เดิมที่ Deploy เป็น Web app ของคลังผลงาน (URL ลงท้าย `...QAUaA/exec`)
2. เปิดไฟล์ `Code.gs` → กด Ctrl+A ลบโค้ดเก่าทั้งหมด → วางโค้ดจากไฟล์ `Code.gs` นี้ → กด 💾 บันทึก
3. ด้านบน เลือกฟังก์ชัน **setup** → กด **Run** → กด Review permissions → เลือกบัญชี → Advanced → Go to … (unsafe) → Allow
   - ดูผลที่ Execution log: ✅ = ปกติ, ⚠️ = ต้องแก้ (เช่น ยังไม่มีผลงานที่เผยแพร่ — ปกติในครั้งแรก)
   - `setup` จะสร้าง **รอบรับผลงานปีงบประมาณ 2570** ให้อัตโนมัติ: เปิดรับวันนี้ · ปิดรับ 18 ธ.ค. 2569 · นำเสนอ 24 ธ.ค. 2569 ณ รพ.สวี
     ไฟล์ที่ส่งเข้ามาจะถูกเก็บในโฟลเดอร์ "ส่งผลงาน" ของแต่ละประเภทในโฟลเดอร์ Drive ของคณะกรรมการ (แก้ได้ที่เมนู รอบรับผลงาน)
4. ตรวจว่ามีรหัสผ่าน Admin: ⚙️ Project Settings → Script Properties → ต้องมี `ADMIN_PASSWORD`
5. **Deploy → Manage deployments → ✏️ (แก้ไข) → Version: New version → Deploy**
   - Execute as: **Me** · Who has access: **Anyone**
   - ⚠️ ห้ามกด "New deployment" เพราะ URL จะเปลี่ยน (ถ้าเปลี่ยน ต้องแก้ `API_URL` ใน index.html และ admin.html)

## หลังอัปเดต ทำตามนี้ในหน้า Admin

1. **ภาพรวม → ส่งกลับเข้าคิว** (รายการที่ OCR ผิดพลาดจากโค้ดเก่า) → กด **ประมวลผลคิว OCR** ซ้ำจนค้างคิว = 0
   - ไม่ต้องเปิด Advanced Drive Service แล้ว ไฟล์ใหญ่เกิน 20 MB จะ OCR จากภาพย่อแทน
2. **ผลงานในคลัง** → ตรวจชื่อ/ผู้จัดทำ/หน่วยงาน → ติ๊กเลือก → **เผยแพร่** (หน้าเว็บแสดงเฉพาะที่เผยแพร่)
3. **รายชื่อหน่วยงาน** → กด "ดึงชื่อที่พบในผลงาน" หรือวางรายชื่อทั้งหมด → บันทึก
4. **รอบรับผลงาน** → ตรวจรอบปี 2570 ที่ระบบสร้างให้ (แก้วัน/หมายเหตุได้) · ปีถัดไปกด "+ สร้างรอบใหม่"
5. **ประกาศผลรางวัล** → ใส่รางวัลรายผลงาน → บันทึก → กด "ประกาศผลตอนนี้"

## ลิงก์ที่ใช้บ่อย

- หน้าเว็บ: https://sawee-hosp.github.io/sawee-hosp/academic/
- ส่งผลงานโดยตรง: https://sawee-hosp.github.io/sawee-hosp/academic/?submit
- ติดตามสถานะผลงาน: https://sawee-hosp.github.io/sawee-hosp/academic/?mine
- หน้า Admin: https://sawee-hosp.github.io/sawee-hosp/academic/admin.html
