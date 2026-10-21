#!/usr/bin/env python3
"""
يلتقط لقطات شاشة الدليل من نسخة تشغيل محلية ببيانات seed-demo.
Captures the user-guide screenshots from a local instance seeded with seed-demo.

الاستعمال / usage:
  BASE_URL=http://localhost:5173 DEMO_PASSWORD=... ADMIN_EMAIL=boss@demo.test ADMIN_PASSWORD=... \
  OUT=docs/guide/images python3 tools/guide-screenshots/capture.py [shot-name ...]

لإضافة لقطة: أضف سطراً إلى SHOTS (المستخدم، المسار، الاسم) ثم اكتب في المقال ![وصف](images/الاسم.png).
To add a shot: add a line to SHOTS (user, path, name), then reference it in an article as ![desc](images/name.png).
"""
import os
import sys
import time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://localhost:5173")
OUT = os.environ.get("OUT", "docs/guide/images")
DEMO_PW = os.environ["DEMO_PASSWORD"]
ADMIN = (os.environ.get("ADMIN_EMAIL", "boss@demo.test"), os.environ.get("ADMIN_PASSWORD", ""))
COMPANY = os.environ.get("COMPANY", "main")
CHROME = os.environ.get("CHROME", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")

USERS = {
    "employee": ("demo.employee@demo.hrms.local", DEMO_PW),
    "manager": ("demo.manager@demo.hrms.local", DEMO_PW),
    "hr": ("demo.hr@demo.hrms.local", DEMO_PW),
    "admin": ADMIN,
}

# (المستخدم، المسار، اسم الملف) / (user, path, file name)
SHOTS = [
    (None, f"/login?company={COMPANY}", "login"),
    ("employee", "/leave", "my-leave"),
    ("employee", "/attendance", "my-attendance"),
    ("employee", "/me/payslips", "my-payslips"),
    ("employee", "/notifications", "notifications"),
    ("employee", "/me/admin-actions", "my-admin-actions"),
    ("manager", "/approvals", "approvals"),
    ("hr", "/employees", "employees"),
    ("hr", "/payroll/periods", "payroll-periods"),
    ("hr", "/payroll/loans", "loans"),
    ("hr", "/payroll/shortfall", "shortfall"),
    ("hr", "/admin-actions", "admin-actions"),
    ("hr", "/letters/templates", "letters"),
    ("hr", "/reports", "reports"),
    ("admin", "/payroll/payslip-design", "payslip-design"),
    ("admin", "/admin/brand", "brand"),
    ("admin", "/admin/roles", "roles"),
    ("admin", "/admin/channels", "channels"),
    ("admin", "/help", "help"),
]


def design_side_by_side(page):
    # يختار التصميم الجاهز «جانبي» ليظهر المحرر والمعاينة / pick the ready «side by side» design so the editor and preview show
    page.get_by_placeholder("…").click()
    page.get_by_text("جانبي (دخل | اقتطاعات)").first.click()
    time.sleep(2)


# إجراءات اختيارية بعد فتح الصفحة وقبل اللقطة / optional steps after opening the page, before the shot
ACTIONS = {"payslip-design": design_side_by_side}


def login(page, who):
    email, pw = USERS[who]
    page.goto(f"{BASE}/login?company={COMPANY}")
    page.fill('input[autocomplete="username"]', email)
    page.fill('input[autocomplete="current-password"]', pw)
    page.click('button[type="submit"]')
    page.wait_for_url(lambda u: "/login" not in u, timeout=15000)


def main():
    wanted = set(sys.argv[1:])
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"])
        sessions = {}
        for who, path, name in SHOTS:
            if wanted and name not in wanted:
                continue
            if who not in sessions:
                ctx = browser.new_context(viewport={"width": 1366, "height": 820}, locale="ar")
                page = ctx.new_page()
                if who:
                    login(page, who)
                sessions[who] = page
            page = sessions[who]
            page.goto(f"{BASE}{path}")
            page.wait_for_load_state("networkidle")
            if name in ACTIONS:
                ACTIONS[name](page)
            time.sleep(1.2)  # انتهاء الرسوم والمعاينات الحيّة / let animations and live previews settle
            page.screenshot(path=f"{OUT}/{name}.png")
            print("ok", name)
        browser.close()


if __name__ == "__main__":
    main()
