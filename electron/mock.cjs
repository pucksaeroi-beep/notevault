// Sample content for first run. Everything here is FAKE demo data — safe to commit.
'use strict';

const day = 86400000;

function sampleFolders() {
  return [
    { id: 'f-personal', name: 'ส่วนตัว', icon: '🏡', color: '#34c759', order: 1 },
    { id: 'f-work', name: 'งาน', icon: '💼', color: '#0a84ff', order: 2 },
    { id: 'f-ideas', name: 'ไอเดีย', icon: '💡', color: '#ff9f0a', order: 3 },
  ];
}

function sampleNotes() {
  const now = Date.now();
  return [
    {
      id: 'n-welcome', title: 'ยินดีต้อนรับสู่ NoteVault', icon: '👋', folderId: null, tags: ['เริ่มต้น'], pinned: true,
      createdAt: now - 3 * day, updatedAt: now,
      html: `
<p>NoteVault คือแอปจดโน้ต + ตู้เซฟรหัสผ่าน ที่ทำงาน <strong>ในเครื่องเท่านั้น</strong> ไม่มีอินเทอร์เน็ต ไม่มีเซิร์ฟเวอร์</p>
<div data-callout="info"><p><strong>ลองพิมพ์ <code>/</code></strong> ที่ต้นบรรทัด เพื่อเปิดเมนูแทรก: หัวข้อ, ตาราง, รูป, กล่องข้อความ, โค้ด และอื่น ๆ</p></div>
<h2>แก้ไขได้แบบ Word</h2>
<p>เปลี่ยน<span style="font-family: Georgia, serif">ฟอนต์</span> ขนาด <span style="font-size: 22px">ใหญ่</span> / <span style="font-size: 12px">เล็ก</span>,
<span style="color: #ff3b30">สีตัวอักษร</span>, <mark data-color="#fff59d" style="background-color: #fff59d">ไฮไลต์</mark>
<mark data-color="#c8f7c5" style="background-color: #c8f7c5">หลายสี</mark>, <u>ขีดเส้นใต้</u>, <s>ขีดฆ่า</s>, H<sub>2</sub>O, x<sup>2</sup></p>
<p style="text-align: center">จัดกึ่งกลาง ↔ ชิดซ้าย ชิดขวา เต็มบรรทัด</p>
<h2>แบบ Markdown</h2>
<p>พิมพ์ <code># </code> เป็นหัวข้อ, <code>- </code> เป็นรายการ, <code>[] </code> เป็น checklist, <code>&gt; </code> เป็นคำพูด, <code>\`\`\`</code> เป็นบล็อกโค้ด หรือวาง Markdown ทั้งก้อนก็แปลงให้อัตโนมัติ
และกดปุ่ม <strong>M↓</strong> มุมขวาบนเพื่อดู/แก้เป็น Markdown ดิบ</p>
<ul data-type="taskList">
<li data-type="taskItem" data-checked="true"><p>ลองสร้างโน้ตใหม่ (⌘N)</p></li>
<li data-type="taskItem" data-checked="false"><p>ลากรูปมาวาง แล้วลากมุมขวาล่างเพื่อย่อ/ขยาย</p></li>
<li data-type="taskItem" data-checked="false"><p>เปิดแท็บ “รหัสผ่าน” ด้านซ้าย แล้วตั้งรหัสผ่านหลัก</p></li>
</ul>
<h2>แบบ Confluence</h2>
<div data-callout="success"><p>กล่องสีเขียว — สำเร็จ / แนะนำ</p></div>
<div data-callout="warning"><p>กล่องสีเหลือง — ระวัง (คลิกที่ไอคอนเพื่อเปลี่ยนชนิดกล่อง)</p></div>
<table><tbody>
<tr><th><p>ฟีเจอร์</p></th><th><p>คีย์ลัด</p></th><th><p>หมายเหตุ</p></th></tr>
<tr><td><p>ตัวหนา</p></td><td><p>⌘B</p></td><td><p>ใช้ได้ทุกที่</p></td></tr>
<tr><td><p>ค้นหาในโน้ต</p></td><td><p>⌘F</p></td><td data-background="#e3f2fd"><p>คลิกขวาที่ช่องเพื่อใส่สีพื้น</p></td></tr>
<tr><td><p>ล็อกตู้เซฟ</p></td><td><p>⌘L</p></td><td><p>ล็อกอัตโนมัติเมื่อไม่ได้ใช้</p></td></tr>
</tbody></table>
<pre><code class="language-javascript">// บล็อกโค้ดมี syntax highlight
const hello = (name) =&gt; \`สวัสดี \${name}\`;</code></pre>
<blockquote><p>“เก็บทุกอย่างไว้ในเครื่องของคุณเอง”</p></blockquote>`,
    },
    {
      id: 'n-meeting', title: 'ประชุมทีม Sprint 12', icon: '🗓️', folderId: 'f-work', tags: ['ประชุม'], pinned: false,
      createdAt: now - 2 * day, updatedAt: now - 2 * day + 3600000,
      html: `
<p><strong>วันที่:</strong> 18 พ.ย. · <strong>ผู้เข้าร่วม:</strong> เอ, บี, ซี (ข้อมูลตัวอย่าง)</p>
<h2>สรุป</h2>
<ol><li><p>ปล่อยฟีเจอร์ค้นหาใหม่ภายในสัปดาห์หน้า</p></li><li><p>แก้บั๊กหน้า checkout</p></li></ol>
<h2>Action items</h2>
<ul data-type="taskList">
<li data-type="taskItem" data-checked="false"><p>เอ — เขียนเทสต์ระบบค้นหา</p></li>
<li data-type="taskItem" data-checked="true"><p>บี — ออกแบบหน้าใหม่</p></li>
</ul>
<div data-callout="danger"><p>Deadline: ศุกร์นี้ 17:00</p></div>`,
    },
    {
      id: 'n-trip', title: 'ทริปเชียงใหม่', icon: '✈️', folderId: 'f-personal', tags: ['เที่ยว'], pinned: false,
      createdAt: now - 5 * day, updatedAt: now - 1 * day,
      html: `
<h2>แผนเที่ยว 3 วัน</h2>
<table><tbody>
<tr><th><p>วัน</p></th><th><p>ที่เที่ยว</p></th><th><p>งบ (บาท)</p></th></tr>
<tr><td><p>1</p></td><td><p>ดอยสุเทพ, นิมมาน</p></td><td><p>1,500</p></td></tr>
<tr><td><p>2</p></td><td><p>แม่กำปอง</p></td><td><p>2,000</p></td></tr>
<tr><td><p>3</p></td><td><p>ตลาดวโรรส</p></td><td><p>800</p></td></tr>
</tbody></table>
<p><mark data-color="#ffd6a5" style="background-color: #ffd6a5">อย่าลืม:</mark> จองที่พักล่วงหน้า</p>`,
    },
    {
      id: 'n-ideas', title: 'ไอเดียแอปใหม่', icon: '💡', folderId: 'f-ideas', tags: ['ไอเดีย'], pinned: false,
      createdAt: now - 7 * day, updatedAt: now - 4 * day,
      html: `
<h3>รายการไอเดีย</h3>
<ul><li><p>แอปบันทึกรายจ่ายด้วยเสียง</p></li><li><p>ระบบเตือนต่ออายุประกัน</p><ul><li><p>แจ้งเตือนก่อน 30 วัน</p></li></ul></li></ul>
<div data-callout="note"><p>เก็บไว้คิดต่อวันหยุด</p></div>`,
    },
  ];
}

/** Fake vault items — same shape as the real vault. */
function sampleVaultItems() {
  const now = Date.now();
  const f = (label, value, kind = 'text') => ({ label, value, kind });
  return [
    { type: 'login', title: 'Gmail (ตัวอย่าง)', category: 'อีเมล', icon: '✉️', favorite: true, createdAt: now,
      fields: [f('อีเมล', 'demo.user@example.com', 'email'), f('รหัสผ่าน', 'Demo-Pass-1234!', 'password'),
        f('เว็บไซต์', 'https://mail.google.com', 'url'), f('2FA (TOTP)', 'JBSWY3DPEHPK3PXP', 'totp')],
      notes: 'รหัสกู้คืน: (ตัวอย่าง) 1111-2222' },
    { type: 'login', title: 'Facebook (ตัวอย่าง)', category: 'โซเชียล', icon: '📘',
      fields: [f('ชื่อผู้ใช้', 'demo.user', 'text'), f('รหัสผ่าน', 'Demo-Pass-1234!', 'password'), f('เว็บไซต์', 'https://facebook.com', 'url')],
      notes: 'ตั้งใจใช้รหัสซ้ำกับ Gmail เพื่อโชว์ฟีเจอร์ “รหัสซ้ำ”' },
    { type: 'login', title: 'ร้านค้าออนไลน์ (ตัวอย่าง)', category: 'ช้อปปิ้ง', icon: '🛒',
      fields: [f('อีเมล', 'shop@example.com', 'email'), f('รหัสผ่าน', '123456', 'password'), f('เว็บไซต์', 'https://shop.example.com', 'url')],
      notes: 'รหัสอ่อนมาก — ตัวอย่างสำหรับรายการ “รหัสอ่อน”' },
    { type: 'bank', title: 'ธนาคารตัวอย่าง', category: 'ธนาคาร', icon: '🏦', favorite: true,
      fields: [f('เลขบัญชี', '000-0-00000-0', 'text'), f('ชื่อบัญชี', 'นาย ทดสอบ ตัวอย่าง', 'text'),
        f('PIN แอป', '000000', 'pin'), f('รหัสผ่าน Internet banking', 'Bank#Demo2026', 'password')], notes: '' },
    { type: 'card', title: 'บัตรเครดิต (ตัวอย่าง)', category: 'ธนาคาร', icon: '💳',
      fields: [f('ชื่อบนบัตร', 'TEST USER', 'text'), f('เลขบัตร', '4111 1111 1111 1111', 'password'),
        f('หมดอายุ', '12/30', 'text'), f('CVV', '123', 'pin')], notes: 'เลขบัตรทดสอบมาตรฐาน ใช้จ่ายจริงไม่ได้' },
    { type: 'wifi', title: 'Wi-Fi บ้าน (ตัวอย่าง)', category: 'บ้าน', icon: '📶',
      fields: [f('ชื่อเครือข่าย (SSID)', 'Home-Demo-5G', 'text'), f('รหัสผ่าน', 'wifi-demo-pass', 'password')], notes: '' },
    { type: 'note', title: 'รหัสตู้เซฟ (ตัวอย่าง)', category: 'บ้าน', icon: '🔐',
      fields: [f('รหัส', '4-8-15-16', 'pin')], notes: 'บันทึกลับแบบข้อความยาว ๆ ใส่ตรงนี้ได้' },
  ];
}

module.exports = { sampleFolders, sampleNotes, sampleVaultItems };
