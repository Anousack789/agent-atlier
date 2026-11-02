# Agent Atelier

ออฟฟิศ pixel ส่วนตัวสำหรับทีม AI ที่ใช้บัญชี Codex CLI ในเครื่อง รองรับหลายโปรเจกต์ แชต งาน ตารางทำงาน ความทรงจำ และการอนุมัติจากผู้ใช้

## เริ่มใช้งาน

ต้องมี Node.js 24 ขึ้นไป, npm, Git และ Codex CLI ที่ล็อกอินแล้ว (`codex login status`)

```bash
npm install
npm run dev
```

เปิด <http://127.0.0.1:3210> เซิร์ฟเวอร์รับการเชื่อมต่อเฉพาะเครื่องนี้

ใช้งานแบบ production:

```bash
npm run build
npm start
```

หยุดด้วย Ctrl+C งานที่ยังไม่จบจะถูกบันทึกว่า interrupted เพื่อให้ตรวจผลงานก่อนเริ่มใหม่ ปิดแท็บเว็บได้โดยไม่หยุดงาน แต่ต้องเปิดเครื่องและเซิร์ฟเวอร์ไว้สำหรับ schedule

## การใช้งาน

- เริ่มด้วย Atlas, Nova, Sage และ Pixel ทุกคนแก้ชื่อ บทบาท instructions โมเดล และสีตัวละครได้ ค่าเริ่มต้นอ่านอย่างเดียวและยังไม่มีสิทธิ์ Google
- หน้าสร้าง/ตั้งค่าสมาชิกเลือก **ตัวละครเดิม** หรือ **สร้างตัวละคร** ได้ ตัวประกอบ pixel art ทำงานในเครื่อง มีทรงผมสั้น บ๊อบ ยาว และหยิก สีผิว 6 เฉด สีผม สีเสื้อ และแว่น พร้อม preview ใบหน้า/เต็มตัวและปุ่ม **สุ่มตัวละคร** การเปลี่ยนมีผลเมื่อกดบันทึกเท่านั้น ตัวละครเดิมไม่เปลี่ยนเอง
- เพิ่มโปรเจกต์ด้วย path เต็มของโฟลเดอร์ที่มีอยู่ เลือกโปรเจกต์ก่อนสร้างงานหรือเปิดแชต
- สร้างงานแล้วเลือกสมาชิก งานจะเข้าคิวและทำงานพร้อมกันได้สูงสุดสองงาน โดยสมาชิกคนเดียวไม่ทำสองงานพร้อมกัน
- ห้องทีมจะบันทึกข้อความโดยไม่เรียกโมเดลจนกว่าจะเลือกสมาชิกให้ตอบ แชตส่วนตัวเรียกสมาชิกที่เลือกให้ตอบโดยตรง
- แชตทุกห้องแนบรูปด้วยปุ่ม **แนบรูป** หรือวาง screenshot จาก clipboard ได้ มี preview และลบก่อนส่ง ส่งเฉพาะรูปได้ รองรับ PNG/JPEG/WebP แบบภาพนิ่ง สูงสุด 4 รูป รูปละ 5 MiB และไม่เกิน 20 ล้านพิกเซล กดรูปในประวัติเพื่อเปิดภาพเต็มในแท็บใหม่
- agent รับรูปจากข้อความต้นทางก่อน แล้วเติมรูปใหม่สุดจากประวัติ 16 ข้อความที่มีสิทธิ์เห็น รวมไม่เกิน 4 รูปต่อ turn จึงถามต่อได้โดยไม่แนบใหม่ถ้ารูปยังอยู่ในบริบท การส่งรูปให้ agent จะส่งผ่านบัญชี Codex เช่นเดียวกับข้อความ; ห้องทีมที่ไม่เลือกผู้ตอบยังไม่เรียกโมเดล
- draft ข้อความและรูปแยกตามโปรเจกต์/ห้อง เก็บเฉพาะขณะหน้าแชตเปิดอยู่และคงไว้เมื่อส่งไม่ผ่าน แต่ยังไม่บันทึก draft หลัง reload รูปที่ส่งแล้วเก็บถาวรตามประวัติ ยังไม่มีการลบรูปที่ส่งแล้ว ลากไฟล์มาแนบ หรือรองรับ PDF/HEIC
- agent ปรึกษากันได้เอง แต่การส่งต่องาน การใช้สิทธิ์เพิ่ม และการเขียนข้อมูล Google ต้องผ่านหน้า **การอนุมัติ** จำกัดบทสนทนาอัตโนมัติหกรอบก่อนขอให้คุยต่อ
- ดูและแก้ความทรงจำส่วนตัวหรือความรู้ร่วมในหน้า **ความทรงจำ** ระบบส่งเฉพาะข้อมูลของโปรเจกต์ปัจจุบันและความทรงจำส่วนตัวของ agent นั้น
- **จัดห้อง** ใช้ขณะไม่มีงานกำลังทำ ลากเฟอร์นิเจอร์และสมาชิก วางของเพิ่ม หรือลบของที่เลือก แล้วกดบันทึก พื้นที่ทับกันจะไม่ผ่านการบันทึก
- ตารางทำงานรองรับครั้งเดียว รายวัน รายสัปดาห์ และ IANA timezone ค่าเริ่มต้น Asia/Vientiane เมื่อกลับมาเปิดระบบ ตารางที่พลาดจะชดเชยหนึ่งงานและไม่ซ้อนกับงานรอบก่อน

### Preset prompt ตามบทบาท

หน้าสร้าง/ตั้งค่าสมาชิกมี preset 15 บทบาท: Frontend, Backend, Tester, UX/UI Designer, Marketing, DevOps, QA, Customer Support, Server/Linux Security, General Assistant, Planner, Full-stack Developer, Researcher, Content Writer และ Data Analyst เลือก preset เพื่อดูตัวอย่าง Markdown โดยยังไม่เปลี่ยนข้อมูล กด **ใช้ preset** เพื่อแทนที่บทบาทและ prompt ฉบับร่าง หรือ **รีเซ็ต prompt** เพื่อแทนที่เฉพาะ prompt ด้วย preset ที่เลือก จากนั้นแก้ไข Markdown เพิ่มได้ การเปลี่ยนมีผลเมื่อกด **บันทึก** เท่านั้น ปิดหน้าต่างเพื่อทิ้งฉบับร่าง

สมาชิกใหม่เริ่มด้วย General Assistant; office ใหม่ใช้ Planner สำหรับ Atlas, Full-stack Developer สำหรับ Nova, Researcher สำหรับ Sage และ UX/UI Designer สำหรับ Pixel สมาชิกเดิมไม่ถูกเปลี่ยน prompt อัตโนมัติ ระบบจำ preset ที่ใช้แม้ปรับแต่งข้อความ และเก็บทั้ง preset ID กับ Markdown ใน backup เดิมที่ไม่มี preset ID ยังนำเข้าได้ Tester เน้นเขียน tests/ทำ reproduction ส่วน QA เน้น acceptance, regression และความพร้อมก่อน release

ไฟล์ภาษาอังกฤษอยู่ใน `prompts/roles/*.md` มีหัวข้อ Role, Responsibilities, Working Process, Quality Standards, Boundaries และ Deliverables จำกัด 16,000 ตัวอักษร โหลดครั้งเดียวตอนเริ่ม server ผ่าน catalog ที่กำหนดไว้ใน `server/role-presets.ts` และอ่านได้จาก `GET /api/role-presets` เมื่อแก้ไฟล์ให้ restart server แล้วกดรีเซ็ต/บันทึกสมาชิกที่ต้องการ ข้อความที่เคยบันทึกจะไม่เปลี่ยนเอง หากโหลด catalog ไม่สำเร็จจะแสดง error และปุ่มลองใหม่ แต่ยังแก้ไข/บันทึกคำสั่งสมาชิกเดิมได้

Prompt ส่งเป็น developer instructions ภายใต้ข้อกำหนดของ Codex และ safeguards ของ office ไม่ได้เพิ่มสิทธิ์หรือยกเลิกการอนุมัติ

ตรวจฟีเจอร์ preset วันที่ 2026-11-02 ด้วย Node.js 26.3.1: `npm run typecheck`, `npm test` (44 tests) และ `npm run build` ผ่าน ตรวจ 15 ไฟล์/ID/หัวข้อ/ขนาด, ไฟล์หายหรือเนื้อหาผิด, seed ของ office ใหม่, สมาชิกเดิม, prompt ที่ปรับแต่ง, restart, backup round trip และ fake Codex ที่ได้รับ Markdown พร้อม safeguards เดิม

ตรวจ production ผ่าน in-app browser ด้วยข้อมูลชั่วคราวบน port 3242 ที่ 1536×1024 และ 390×844: เลือกโดยไม่ทับ prompt, Apply ด้วย Enter, Reset ด้วย Space, ปรับแต่ง/บันทึก/reload, ปิดโดยไม่บันทึก, default สมาชิกใหม่, สร้าง QA บนมือถือ และเปิด preview ด้วย keyboard ผ่าน ไม่พบ horizontal overflow หรือ framework error overlay และ console ไม่มี warning/error ตรวจ catalog/Host/Origin ผ่าน HTTP และใช้ read-only proxy บน port 3243 จำลอง 503 เพื่อตรวจ error, editor/Save ที่ยังใช้งานได้ และ Retry ที่คง draft ไว้ ไม่ได้ใช้ Codex หรือ Google จริง ไม่แตะ `.data/` ของผู้ใช้ และหยุดเซิร์ฟเวอร์ทดสอบหลังตรวจ

### งานโค้ด

โปรเจกต์ต้องมี Git repository, initial commit, branch ที่ระบุชื่อได้ และไม่มีไฟล์ที่ยังไม่ commit ก่อนเริ่ม สมาชิกต้องได้รับสิทธิ์ workspace-write งานจะใช้ branch `codex/office-*` กับ worktree ของตัวเอง โฟลเดอร์หลักจะยังไม่เปลี่ยนจนกดอนุมัติรวมงาน

เปิดรายละเอียดงาน อ่านผลลัพธ์และผลทดสอบจาก agent แล้วเปิด diff ก่อนกดรวม ระบบจะ commit การแก้ไขใน worktree และ merge กลับ branch เดิม โดยไม่ push หากเกิด conflict จะ abort การ merge และเก็บ worktree ไว้ให้ตรวจต่อ

ปุ่ม **เริ่ม Git…** ขออนุมัติรัน `git init` เท่านั้น คุณต้องเลือกไฟล์และทำ initial commit เอง เพื่อไม่ให้แอปนำไฟล์ส่วนตัวหรือ secret ไป track อัตโนมัติ

### Gmail และ Google Calendar

ไปที่ **เชื่อมต่อ** แล้วตั้งค่า Google OAuth Client ประเภท Desktop app จาก Google Cloud project ที่เปิด Gmail API และ Calendar API หาก consent screen อยู่ใน Testing ให้เพิ่มบัญชีคุณเป็น test user จากนั้นกรอก Client ID / Client secret และกดเชื่อมบัญชี การเชื่อม Google แยกจากการล็อกอิน Codex

ขอ scopes สำหรับอ่าน Gmail/ส่งอีเมล และอ่านนัดหมาย/แก้นัดหมายในปฏิทินที่คุณเป็นเจ้าของ เวอร์ชันนี้ใช้ primary calendar จากบัญชี Google หนึ่งบัญชี เปิดสิทธิ์ Google ให้สมาชิกแต่ละคนจากหน้าตั้งค่าสมาชิก

การส่งอีเมลและสร้าง/แก้นัดหมายจะแสดงเนื้อหา ผู้รับ เวลา เขตเวลา และผู้เข้าร่วมให้อนุมัติก่อนเสมอ การอนุมัติซ้ำไม่ส่งคำสั่งซ้ำ หากระบบหยุดหรือเครือข่ายขาดระหว่างส่ง แอปจะแสดงผลว่าไม่แน่ชัดและไม่ retry เอง ให้ตรวจ Gmail/Calendar ก่อนเริ่มใหม่ OAuth token อาจต้องเชื่อมใหม่ตามนโยบาย Google โดยเฉพาะแอปใน Testing

ยังไม่ได้ทดสอบ OAuth และการส่งข้อมูลกับบัญชี Google จริง การทดสอบอัตโนมัติใช้ provider จำลองเพื่อยืนยันขอบเขตการอนุมัติ

### Export / Import office

เปิดหน้า **สำรองข้อมูล** แล้วกด **Export office** เพื่อดาวน์โหลดไฟล์ JSON สูงสุด 100 MiB รวมผังห้อง สมาชิกและรูปลักษณ์ instructions โมเดล สิทธิ์ โปรเจกต์ งาน แชตพร้อมรูป ความทรงจำ ตารางงาน และประวัติการอนุมัติ ต้องไม่มีงาน queued/running/waiting, การ merge หรือการดำเนินการภายนอกค้างอยู่ก่อน export/import กด **หยุดทั้งทีม** เพื่อหยุดงานได้ แต่ต้องรอ external action ที่เริ่มแล้วให้จบก่อน

เลือกไฟล์เพื่อนำเข้า ระบบจะตรวจ version ข้อมูลอ้างอิง ผังห้อง และรูปภาพ แล้วแสดงวันสำรอง จำนวนข้อมูล และ project paths ที่หาไม่พบ กด **ยืนยันแทนที่ office** เพื่อแทนที่ข้อมูลทั้งหมด ไม่มีโหมดรวมข้อมูล ก่อนแทนที่จะสร้างไฟล์สำรองเดิมพร้อมรูปใน `<OFFICE_DATA_DIR>/backups/` (ค่าเริ่มต้น `.data/backups/`) โดยจำกัดสิทธิ์ไฟล์สำหรับเจ้าของเครื่อง หากสำรองหรือการนำเข้าล้มเหลวจะคงข้อมูลเดิมไว้ หน้าจอแสดง path ของไฟล์สำรองหลังสำเร็จ สามารถเลือกไฟล์นั้นเพื่อนำเข้ากลับได้

หลังนำเข้า ทีมจะพักแม้ restart เซิร์ฟเวอร์ งานค้างเปลี่ยนเป็น interrupted ตารางงานทั้งหมดปิด และคำขออนุมัติที่ pending หมดอายุ ผล executing เปลี่ยนเป็น unknown ส่วน unknown เดิมยังคงอยู่ ต้องตรวจบริการปลายทางก่อนทำซ้ำ ตรวจ path ในหน้าโปรเจกต์และสิทธิ์สมาชิกก่อนเปิดทีมและเปิดตารางงานที่ต้องการเอง ไม่มีการรันชดเชยหรือลองงานเดิมซ้ำโดยอัตโนมัติ

ไฟล์สำรองไม่รวมโค้ด โฟลเดอร์โปรเจกต์ Git/worktree, Codex login, Google Client ID/secret หรือ token ข้อมูลเชื่อม Google ของเครื่องปลายทางคงเดิม แต่สิทธิ์ Google ของสมาชิกที่นำเข้าจะปิดไว้ Project paths ยังคงเป็น path ต้นทาง ต้องแก้เองหากย้ายเครื่อง งานโค้ดที่นำเข้าอ่านย้อนหลังได้ แต่ไม่สามารถดู diff หรือ merge จากข้อมูลสำรอง เพราะไม่กู้ Codex session และข้อมูลอ้างอิง worktree/branch ระบบไม่ลบหรือเขียนทับไฟล์โปรเจกต์/worktree เดิม

ไฟล์ JSON ไม่ได้เข้ารหัสและมีข้อความ ความทรงจำ และข้อมูลส่วนตัวที่เคยป้อนให้ทีม รวมถึง secret ที่คุณอาจพิมพ์ไว้เอง ควรเก็บไฟล์ดาวน์โหลดและไฟล์ใน `backups/` อย่างปลอดภัย รูปเก่าที่ไม่มีข้อความอ้างอิงจะถูกเก็บกวาดตามกลไกเดิมเมื่อเริ่มเซิร์ฟเวอร์ใหม่ ส่วนไฟล์สำรองก่อนนำเข้าจะไม่ถูกลบอัตโนมัติ

## โครงสร้างและข้อมูล

Next.js/React เป็น UI; Phaser เป็นฉาก pixel; Node server เปิด Codex App Server ผ่าน stdio JSON-RPC, รับคำสั่ง HTTP และส่ง snapshot ผ่าน SSE; SQLite เก็บข้อมูลถาวร ไม่มีบริการฐานข้อมูลหรือ queue แยก

ข้อมูลในเครื่องอยู่ใต้ `.data/` ซึ่งถูกละเว้นจาก Git: `office.sqlite`, `google-tokens.json`, workspace เริ่มต้น, `attachments/` และ `worktrees/` ไฟล์ข้อมูล/credential ตั้ง permission สำหรับเจ้าของเครื่องเท่านั้น และไม่ส่ง credential เข้า browser snapshot หรือ model context สำรองโฟลเดอร์นี้ขณะหยุดเซิร์ฟเวอร์

ตัวแปรที่รองรับ: `PORT` (3210), `OFFICE_DATA_DIR` (absolute path ของโฟลเดอร์ข้อมูลอื่น), `CODEX_BIN` (ตำแหน่ง Codex หากไม่อยู่ใน PATH) เวอร์ชันนี้เป็น local single-user ไม่เปิดให้เครือข่ายภายนอก

คำสั่ง agent อยู่ภายใต้คำสั่งและ sandbox ของ Codex ใช้โมเดลจาก `model/list` และแสดงข้อผิดพลาดหากบัญชีเรียกโมเดลนั้นไม่ได้ App Server/dynamic tools ยังเป็น integration ที่อาจเปลี่ยนตามเวอร์ชัน Codex

## ตรวจสอบ

บันทึกการตรวจเดิมด้วย Node.js 26.3.1 และ Codex CLI 0.165.0: 22 automated tests, typecheck และ production build ผ่าน รวมถึงทดลองสร้างสมาชิก เรียก Codex จริง บันทึกความทรงจำ สนทนาระหว่าง agent และอนุมัติส่งต่องานผ่านหน้าเว็บ ทดสอบ IAB ที่ 1536×1024 และ 390×844 รวมการลากเฟอร์นิเจอร์ การใช้ keyboard และการเลือกสมาชิกบนมือถือ

```bash
npm run typecheck
npm test
npm run build
```

ชุดทดสอบครอบคลุม SQLite rollback/persistence, การแยกบริบทและความทรงจำ, คิวสองงาน, delegation/approval, การป้องกัน external write ซ้ำ, ขีดจำกัดบทสนทนา, schedule/timezone/DST/catch-up, restart recovery, Git worktree/merge/conflict และขอบเขตการวางเฟอร์นิเจอร์

ภาพแนวทางอยู่ที่ `docs/design/concept.png` และ visual specification อยู่ที่ `docs/design/design-system.md` ตัวละคร ฉาก และเฟอร์นิเจอร์เป็น generated assets แยกชิ้น ไม่ใช้ screenshot เป็นหน้าจอที่กดไม่ได้

ตัวประกอบ avatar ใช้ชิ้นส่วน pixel ที่กำหนดในโค้ดบนกริด 32×32 ขยายเป็น 96×96 โดยใช้ renderer เดียวกันสำหรับโปรไฟล์และฉากออฟฟิศ เก็บ `avatarParts` เพิ่มในข้อมูลสมาชิก JSON เดิม ข้อมูลเก่าที่ไม่มีค่านี้ยังใช้ตัวละครเดิม ไม่ต้อง migrate ฐานข้อมูล รุ่นแรกมีชุดและลำตัวทรงเดียว ไม่รองรับ AI generation, อัปโหลดรูปตัวละคร, export รูปตัวละครแยกไฟล์ หรือ animation เพิ่มเติม (ข้อมูลรูปลักษณ์รวมอยู่ในไฟล์สำรอง office)

### ตรวจเพิ่ม — Pixel Avatar Generator (2026-11-02)

Node.js 26.3.1: `npm run typecheck`, `npm test` (27 tests) และ `npm run build` ผ่าน เพิ่มการทดสอบ validation ของชิ้นส่วนทั้ง 48 ชุด, input ผิด, การสุ่มเฉพาะรูปลักษณ์, texture identity, การบันทึก/เปิด Store ใหม่/กลับตัวละครเดิม และการห้ามแก้สมาชิกที่กำลังทำงาน

ตรวจ production build ผ่าน IAB ที่ 1536×1024 และ 390×844 ด้วยฐานข้อมูลชั่วคราวแยกจาก `.data/`: เลือกชิ้นส่วนทั้ง 48 ชุด, preview ใบหน้า/เต็มตัว, สุ่ม, ปิดโดยไม่บันทึก, บันทึกและ reload, กลับตัวละครเดิม, สร้างสมาชิกใหม่บนมือถือ และภาพในฉาก/โปรไฟล์ตรงกัน ไม่พบ console warning/error หรือ framework error overlay ทดสอบ keyboard Enter/Space กับโหมด สีผิว และแว่นแล้ว การเปลี่ยนสีทดสอบผ่านปุ่มสุ่ม; native color picker เปิดได้แต่ automation ยังเลือกสีเองผ่าน popup ไม่สำเร็จ ไม่ได้เรียกงาน Codex หรือเขียนข้อมูล Google จริงในการตรวจฟีเจอร์นี้

### เปลี่ยนชื่อเป็น Agent Atelier — 2026-11-02

ชื่อผลิตภัณฑ์เป็น Agent Atelier, package เป็น `agent-atelier` และโฟลเดอร์ local เป็น `agent-atelier` ย้ายข้อมูลเดิมพร้อมปรับ project/task paths ภายใต้โฟลเดอร์เดิม และแก้ path ของโปรเจกต์เริ่มต้นให้ใช้ `.data/workspace` ในตำแหน่งใหม่ คงชื่อ `office.sqlite`, `OFFICE_DATA_DIR`, localStorage key `agent-office-project`, tools `office_*` และ branch prefix `codex/office-*` เพื่อความเข้ากันได้ ไม่สร้าง commit หรือ remote อัตโนมัติ

สคริปต์ย้าย path ครั้งเดียว: `node --import tsx scripts/relocate-data.ts <old-root> <new-root> <data-dir>` ทุก argument ต้องเป็น absolute path และ data directory ต้องมีฐานข้อมูลเดิมแล้ว หยุดเซิร์ฟเวอร์และสำรอง `.data/` ก่อนใช้ สคริปต์แก้เฉพาะ `Project.path` และ `Task.workspace` ที่อยู่ใต้ root เดิมใน transaction ไม่แก้ข้อความ ความทรงจำ หรือ credentials; root เก่าและใหม่ควรเป็นโฟลเดอร์พี่น้องตามการ rename ครั้งนี้

ตรวจจากโฟลเดอร์ใหม่: typecheck, 28 tests และ production build ผ่าน รวม path ตรงตัว/ลูก/ภายนอก/ชื่อคล้ายกันและการรัน migration ซ้ำ ตรวจสมาชิก 4 คน โปรเจกต์ 1 รายการ และ layout เดิมครบ โดย workspace เริ่มต้นมีอยู่จริง ตรวจ UI ผ่าน Brave headless/CDP ที่ 1536×1024 และ 390×844 เพราะ in-app browser เริ่ม runtime ไม่ได้หลังย้าย workspace: browser title/ชื่อแอปถูกต้อง ไม่มีชื่อถูกตัดหรือ horizontal overflow เลือกโปรเจกต์เดิม สลับทีมแชตกลับออฟฟิศ และใช้ Tab ได้ ไม่มี application console error หรือ warning พบเฉพาะ `/favicon.ico` ตอบ 404 ซึ่งไม่ได้แก้ในงาน rename ไม่ได้ทดสอบส่งงาน Codex หรือ Google write จริงในรอบนี้

### ตรวจเพิ่ม — Export / Import Office (2026-11-02)

Node.js 26.3.1: `npm run typecheck`, `npm test` (41 tests ใน checkout ขณะตรวจ) และ `npm run build` ผ่าน เพิ่มการทดสอบสำรอง/กู้ข้อมูลทุกหมวดและรูป, การกัน credentials, validation/version/ID/references/ผังห้อง/ขนาดไฟล์, token ผูกกับไฟล์และใช้ได้ครั้งเดียว, lock ระหว่างนำเข้า, scheduler, rollback เมื่อเขียนรูปหรือ SQLite ล้มเหลว, การหยุดเมื่อสร้างสำรองเดิมไม่ได้ และ paused state หลังเปิด Store/runtime ใหม่ รวมการคง paused เมื่อแก้ Google configuration

ตรวจ production ผ่าน in-app browser บน `http://127.0.0.1:3238/` ที่ 1536×1024 และ 390×844 ด้วยข้อมูลชั่วคราวแยกจาก `.data/`: export ดาวน์โหลด JSON จริง, preview จำนวนข้อมูลและ missing paths, ยกเลิกด้วย Escape, ยืนยันด้วย Enter บน desktop และปุ่มบนมือถือ, แสดงไฟล์สำรองก่อนแทนที่, สมาชิก/แชต/รูปกลับมาครบ, ปฏิเสธ JSON เสียและไฟล์เกิน 100 MiB และทีมยังพักหลัง restart ตรวจ title/content/ไม่มี framework overlay/ไม่มี horizontal overflow และ console ไม่มี warning/error จากแอป

ตรวจ HTTP เพิ่มกับเซิร์ฟเวอร์ทดสอบ: ทุก backup route ปฏิเสธ Host/Origin ภายนอกและ Origin ที่ขาด, ปฏิเสธ JSON เสียและ content type ผิด, ปฏิเสธ request เกิน 100 MiB ฝั่ง server, download ใช้ attachment/no-store และ snapshot หลัง restore มีทีมพัก งาน interrupted และ schedule ปิด การตรวจนี้ตั้ง `CODEX_BIN` เป็นไฟล์ที่ไม่มีอยู่โดยเจตนา จึงมีแถบแจ้ง Codex ไม่พร้อม ไม่ได้เรียก Codex หรือ Google จริง ไม่แตะข้อมูล office เดิม และหยุดเฉพาะเซิร์ฟเวอร์ทดสอบเมื่อเสร็จ

### แนบรูปในแชต — 2026-11-02

API ใหม่ `POST /api/messages` รับ `projectId`, `channel`, `to?`, `body` และ `images?: { name, mime, base64 }[]` จำกัด JSON 28 MiB เฉพาะ endpoint นี้; `/api/action` เดิมยังจำกัด 256 KiB และส่งข้อความแบบเดิมได้ บันทึกเฉพาะ metadata ใน `Message.images` และ `Task.sourceMessageId` ข้อมูลเก่าไม่ต้อง migrate ตาราง ตัวรูปใช้ UUID ใต้ data directory, ปรับ EXIF orientation และตัด metadata ด้วย sharp โดยไม่เพิ่มสิทธิ์ filesystem ให้ agent ส่งให้ Codex ด้วย `localImage`

`GET /api/messages/:messageId/images/:imageId` ตรวจว่ารูปเป็นของข้อความนั้น ส่งรูปด้วย `no-store`, `nosniff` และ same-origin resource policy Snapshot/SSE ไม่มี base64 หรือ path ของไฟล์แนบ บันทึกข้อความ/งานใน transaction และล้างไฟล์ที่ไม่มีข้อความอ้างอิงหลัง restart เฉพาะชื่อ UUID ที่ฟีเจอร์สร้าง ไฟล์รูปหายหรือโมเดลไม่รับภาพจะแสดง error โดยไม่ retry แบบตัดภาพทิ้ง

ตรวจฟีเจอร์แนบรูปด้วย Node.js 26.3.1: typecheck, `npm test` (41 tests ใน checkout ปัจจุบัน รวมชุด backup ที่พัฒนาร่วมกัน) และ production build ผ่าน ชุด image tests ใช้ Codex จำลองตรวจ source message ที่หลุดจาก 16 ข้อความล่าสุด, ขีดจำกัด 4 รูป, บริบทแยกโปรเจกต์/ห้องส่วนตัว, ไฟล์หาย, โมเดลปฏิเสธภาพโดยไม่ retry, rollback, cleanup, permission, MIME ปลอม, ภาพเสีย, WebP/APNG เคลื่อนไหว, pixel/byte limits และ EXIF orientation/metadata

ตรวจ HTTP กับ data directory ชั่วคราวบน port 3212: Host/Origin, same-origin POST, image ID ต้องเป็นของข้อความนั้น, path traversal, response headers, input limits, API ข้อความเดิม และ snapshot ที่มีเฉพาะ metadata ผ่าน ตรวจ production ผ่าน in-app browser ที่ 1536×1024 และ 390×844: เลือกไฟล์, วางรูป/ข้อความจาก clipboard, preview, ลบด้วย Enter/Space, draft แยกห้อง, ส่งเฉพาะรูป, ส่งรูปพร้อมข้อความบนมือถือ, เก็บ draft หลัง server ปฏิเสธรูปเสีย และรูปคงอยู่หลัง restart/reload ไม่มี horizontal overflow หรือ framework overlay; fresh tab หลัง reload ไม่มี console warning/error (รอบจงใจส่งรูปเสียได้ HTTP 400 ตามคาด)

ทดลอง Codex จริงผ่าน UI ด้วยภาพสังเคราะห์วงกลมแดงและสี่เหลี่ยมน้ำเงินในห้องทีม แล้วถาม Atlas โดยไม่แนบซ้ำ ได้คำตอบตรงภาพทั้งสีและรูปทรง ไม่ได้ทดสอบทุกโมเดลหรือทุก browser และไม่ได้เขียน Gmail/Calendar จริงในรอบนี้ เซิร์ฟเวอร์และข้อมูลทดสอบแยกจาก `.data/` ของผู้ใช้
