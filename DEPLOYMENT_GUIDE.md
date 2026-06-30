# 🚀 Telegram Bot Builder - Serverga PM2 orqali Deploy qilish bo'yicha Qo'llanma

Ushbu loyihani `201.51.29.54` (root) serveringizda doimiy (24/7) va xavfsiz holatda ishga tushirish uchun quyidagi qadamlarni bajaring.

---

## 1-qadam: GitHub'ga yuklash (Local Kompyuterda)

Loyiha uchun `.gitignore` va `.env` sozlamalari tayyorlandi. Endi loyihani GitHub'ga yuklang:

1. **Git statusini tekshirish:**
   ```powershell
   git status
   ```
   *(Faqat kerakli fayllar ko'rinayotganiga va `.env`, `database.json`, zip fayllar ignored qilinganiga ishonch hosil qiling)*

2. **Commit yaratish:**
   ```powershell
   git add .
   git commit -m "feat: secure config and prepare for deploy"
   ```

3. **GitHub'da yangi repozitoriy yarating** va quyidagi buyruqlar orqali kodni yuklang:
   ```powershell
   git branch -M main
   git remote add origin https://github.com/FOYDALANUVCHI_NOMI/REPO_NOMI.git
   git push -u origin main
   ```

---

## 2-qadam: Serverga bog'lanish va Muhitni tayyorlash (SSH)

1. **Serverga SSH orqali kiring:**
   ```powershell
   ssh root@201.51.29.54
   ```
   *(Parol yoki SSH kalitingizni kiriting)*

2. **Serverda Node.js va npm o'rnatilganini tekshiring:**
   ```bash
   node -v
   npm -v
   ```
   Agar o'rnatilmagan bo'lsa, Node.js v18 yoki v20 versiyasini o'rnating:
   ```bash
   # Ubuntu/Debian uchun NodeSource orqali:
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

3. **PM2 ni global o'rnating:**
   PM2 botlar doimiy (24/7) fonda ishlab turishini ta'minlaydi.
   ```bash
   npm install -g pm2
   ```

---

## 3-qadam: Loyihani serverga yuklash va o'rnatish

1. **Loyiha papkasini yarating va kodni klon qiling:**
   ```bash
   cd /var
   mkdir www && cd www
   git clone https://github.com/FOYDALANUVCHI_NOMI/REPO_NOMI.git
   cd REPO_NOMI
   ```

2. **Kutubxonalarni o'rnatish (Production rejimida):**
   ```bash
   npm install --production
   ```

3. **`.env` faylini yaratish va sozlash:**
   Serverda alohida xavfsiz `.env` faylini yarating:
   ```bash
   nano .env
   ```
   Quyidagi ma'lumotlarni o'zingizniki bilan to'ldirib yozing:
   ```env
   BOT_TOKEN=8984346807:AAFsVQew3ZEhWDs3fsFhg6DuabO1Jy8WT58
   ADMIN_ID=1323217434
   ```
   *(Faylni saqlash uchun `Ctrl+O`, keyin `Enter` bosing va chiqish uchun `Ctrl+X` bosing)*

---

## 4-qadam: PM2 orqali botni ishga tushirish

1. **Asosiy Builder Botni ishga tushirish:**
   ```bash
   pm2 start index.js --name builder-bot
   ```

2. **Bot holatini tekshirish:**
   ```bash
   pm2 list
   ```
   Bot `online` statusda bo'lishi kerak.

3. **Server o'chib-yonkanda avtomatik ishga tushishni yoqish:**
   ```bash
   pm2 startup
   ```
   *(Ekrandagi chiqqan buyruqni nusxalab, terminalda ishga tushiring)*
   
   So'ngra, PM2 holatini saqlab qo'ying:
   ```bash
   pm2 save
   ```

---

## 5-qadam: Bot loglarini ko'rish

Botda qandaydir xatoliklar yuz bersa yoki ishlashini kuzatish uchun:
```bash
pm2 logs builder-bot
```

Siz yaratadigan mijoz botlarining loglarini ko'rish uchun:
```bash
# Masalan 12345678 ID li user bot logi:
pm2 logs bot_12345678
```
