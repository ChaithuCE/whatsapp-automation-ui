const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const nodemailer = require('nodemailer');
const cors = require('cors');
const multer = require('multer');
const { parse } = require('csv-parse');
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  delay,
} = require('@whiskeysockets/baileys');
const path = require('path');
const schedule = require('node-schedule');
const bodyParser = require('body-parser');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(cors());
app.use(bodyParser.json());

const csvUpload = multer({ storage: multer.memoryStorage() });
const imageUpload = multer({ storage: multer.memoryStorage() });

// Email transporter — replace with your SMTP credentials:
const transporter = nodemailer.createTransport({
  host: "smtp.example.com", // e.g., smtp.gmail.com
  port: 587,
  secure: false,
  auth: {
    user: "marteen837@gmail.com",
    pass: "CEMarry@gmail.com"
  }
});
const notifyEmail = "notify-to@example.com";

function normalizeHeader(header) {
  return header.toLowerCase().replace(/[\s_]+/g, '');
}

let sock;
let latestQR = null;

// Root health check route
app.get('/', (req, res) => {
  res.send('WhatsApp Automation Backend is running!');
});

async function startWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(path.resolve(__dirname, 'auth_info'));
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false,
      markOnlineOnConnect: true,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, qr } = update;
      if (qr) {
        latestQR = qr;
        console.log('QR Code generated, waiting for scan...');
        io.emit('whatsapp-qr', { qr });
      }
      if (connection === 'open') {
        latestQR = null;
        io.emit('whatsapp-connected');
        console.log('WhatsApp connection established.');
      }
      if (connection === 'close') {
        console.log('WhatsApp connection closed. Restarting...');
        setTimeout(startWhatsApp, 3000);
      }
    });

    // Emit message delivery status updates
    sock.ev.on('messages.update', (updates) => {
      updates.forEach((update) => {
        io.emit('message-status-update', {
          messageId: update?.key?.id || 'unknown',
          recipient: update?.key?.remoteJid || 'unknown',
          fromMe: update?.key?.fromMe === true,
          status: update?.update,
          time: update.timestamp ? new Date(update.timestamp * 1000).toLocaleString() : new Date().toLocaleString(),
        });
      });
    });
  } catch (e) {
    console.error('Error connecting WhatsApp:', e);
  }
}

startWhatsApp();

// API to get the latest QR code (called by frontend on user click)
app.get('/whatsapp-qr', (req, res) => {
  if (latestQR) return res.json({ qr: latestQR });
  res.status(404).json({ error: "No QR code available. WhatsApp may be connected." });
});

// API to fetch all groups and communities of the connected WhatsApp
app.get('/get-groups', async (req, res) => {
  try {
    if (!sock || !sock.user) return res.status(503).json({ error: "WhatsApp not connected." });
    const groups = await sock.groupFetchAllParticipating();
    const groupList = Object.values(groups).map(g => ({
      name: g.subject,
      id: g.id,
      announcement: !!g.announcement,
    }));
    res.json({ groups: groupList });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// CSV group upload endpoint (optional)
app.post('/upload-csv', csvUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const csvData = req.file.buffer.toString('utf-8');
  const records = [];
  let parseErrorSent = false;
  parse(csvData, {
    columns: (header) => {
      const normalized = header.map(normalizeHeader);
      const required = ['name', 'groupid', 'chatid'];
      for (const col of required) if (!normalized.includes(col)) throw new Error(`Missing column: "${col}"`);
      return normalized;
    },
    skip_empty_lines: true,
    relax_column_count: true,
  })
    .on('error', err => {
      if (!parseErrorSent && !res.headersSent) {
        parseErrorSent = true;
        res.status(400).json({ error: err.message });
      }
    })
    .on('readable', function () {
      let record;
      while ((record = this.read())) {
        const normalizedRecord = {};
        for (const key in record) {
          const nk = normalizeHeader(key);
          if (nk === 'groupid') normalizedRecord['group_id'] = record[key];
          else if (nk === 'name') normalizedRecord['name'] = record[key];
          else if (nk === 'chatid') normalizedRecord['chat_id'] = record[key];
        }
        records.push(normalizedRecord);
      }
    })
    .on('end', () => {
      if (!parseErrorSent && !res.headersSent) {
        res.json({ totalGroups: records.length, previewGroups: records });
      }
    });
});

// Send messages endpoint (text + image + rich text)
app.post('/send-messages', imageUpload.single('image'), async (req, res) => {
  const { message, caption, joinLink, scheduleDateTime, recipients, html } = req.body;
  if (!message && !html) return res.status(400).json({ error: "Message content missing" });

  let recipientList;
  try {
    recipientList = typeof recipients === 'string' ? JSON.parse(recipients) : recipients;
    if (!Array.isArray(recipientList) || recipientList.length === 0)
      return res.status(400).json({ error: "'recipients' must be a non-empty array." });
  } catch {
    return res.status(400).json({ error: "Failed to parse 'recipients' JSON." });
  }

  if (!sock || !sock.user) return res.status(503).json({ error: "WhatsApp is not connected." });

  let fullMsg = message;
  if (joinLink && joinLink.trim()) fullMsg += `\n\n${joinLink.trim()}`;
  let formattedMsg = fullMsg;
  if (html) {
    formattedMsg = markdownToBaileys(html);
  }

  let scheduled = false;
  let when = null;
  if (scheduleDateTime && scheduleDateTime.trim()) {
    when = new Date(scheduleDateTime);
    if (when < new Date()) return res.status(400).json({ error: "Schedule time cannot be past." });
    scheduled = true;
  }

  const sendMessages = async () => {
    for (const recipient of recipientList) {
      const jid = (recipient.group_id || recipient.chat_id || recipient.id || '').trim();
      // Accept groups (@g.us) and communities (@broadcast)
      if (!jid.match(/(@g\.us|@broadcast)$/)) {
        console.warn(`Skipping invalid recipient jid: ${jid}`);
        continue;
      }
      try {
        let msgInfo;
        if (req.file) {
          msgInfo = await sock.sendMessage(jid, {
            image: req.file.buffer,
            mimetype: req.file.mimetype,
            caption: caption ? caption + "\n" + formattedMsg : formattedMsg,
            jpegThumbnail: Buffer.alloc(0), // avoids issues with thumbnails
          });
        } else {
          msgInfo = await sock.sendMessage(jid, { text: formattedMsg });
        }

        io.emit('message-status-update', {
          messageId: msgInfo.key?.id || 'unknown',
          recipient: jid,
          fromMe: true,
          status: "sent",
          time: new Date().toLocaleString(),
        });

        // Optional: send email notifications here

        await delay(1200);
      } catch (e) {
        io.emit('message-status-update', {
          messageId: 'unknown',
          recipient: jid,
          fromMe: true,
          status: "failed",
          time: new Date().toLocaleString(),
        });
        console.error(`Failed to send message to ${jid}:`, e.message);
      }
    }
  };

  try {
    if (scheduled) {
      schedule.scheduleJob(when, sendMessages);
      res.json({ message: `Message scheduled for ${recipientList.length} group(s) at ${when.toLocaleString()}.` });
    } else {
      sendMessages().then(() => console.log('All messages sent.'));
      res.json({ message: `Message sent to ${recipientList.length} group(s).` });
    }
  } catch (error) {
    res.status(500).json({ error: 'Internal error while sending.' });
  }
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`WhatsApp Automation Backend listening on port ${PORT}`);
});

// Helper: Convert HTML (from rich text editor) to WhatsApp Markdown
function markdownToBaileys(html) {
  return html
    .replace(/<b>(.*?)<\/b>/gi, '*$1*')
    .replace(/<strong>(.*?)<\/strong>/gi, '*$1*')
    .replace(/<i>(.*?)<\/i>/gi, '_$1_')
    .replace(/<em>(.*?)<\/em>/gi, '_$1_')
    .replace(/<u>(.*?)<\/u>/gi, '~$1~')
    .replace(/<div>|<\/div>|<p>|<\/p>|<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '');  // Remove any other HTML tags
}
