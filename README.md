# IRRIC5 – Rice field trial data collection (PWA)

Mobile-first web app (Lao + English) for entering rice plot data in the field and saving it to **Google Sheets**.
Installable from Google Chrome, works offline (queues records and syncs when the internet is back).

- Frontend: plain HTML/CSS/JS (no build step) → deploy on **Cloudflare Pages** from a **GitHub** repo
- Backend: **Google Apps Script** Web App bound to the Sheet (`apps-script/Code.gs`)
- Full step-by-step guide (Lao): see **INSTALL_LO.md**

Cloudflare Pages settings: Framework preset **None**, Build command **(empty)**, Output directory **/**.
Project name: `irric5` → `https://irric5.pages.dev`
