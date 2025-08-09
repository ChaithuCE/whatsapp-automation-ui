const express = require('express');
const http = require('http');                     // For Socket.IO
const { Server } = require('socket.io');          // For Socket.IO
const nodemailer = require('nodemailer');         // For email

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const cors = require('cors');
const multer = require('multer');
const { parse } = require('csv-parse');
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  delay,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const schedule = require('node-schedule');
const bodyParser = require('body-parser');

// Replace with your actual SMTP configuration
const transporter = nodemailer.createTransport({
  host: "smtp.example.com",         // e.g. smtp.gmail.com
  port: 587,                        // 465 for SSL, 587 for TLS
  secure: false,                    // false for TLS
  auth: {
    user: "your-email@example.com",    // your SMTP email
    pass: "your-email-password",        // your SMTP password or app password
  }
});

// Email address where notifications will be sent
const notifyEmail = "notify-to@example.com";

app.use(cors());
app.use(bodyParser.json());

const csvUpload = multer({ storage: multer.memoryStorage() });
const imageUpload = multer({ storage: multer.memoryStorage() });

app.get('/', (req, res) => {
  res.send('WhatsApp Automation Backend is running!');
});

function normalizeHeader(header) {
  return header.toLowerCase().replace(/[\s_]+/g, '');
}

let sock;
let latestQR = null; // Store latest QR for API endpoint

async function startWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(path.resolve(__dirname, 'auth_info'));
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      auth: state,
      version,
      printQRInTerminal: false, // We'll send QR via Socket.IO
      markOnlineOnConnect: true,
      syncFullHistory: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        latestQR = qr;
        io.emit('whatsapp-qr', { qr }); // Emit QR code to frontend clients
        console.log('QR Code generated and sent to frontend.');
      }
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
        console.log('WhatsApp connection closed. Reconnecting?', shouldReconnect);
        if (shouldReconnect) setTimeout(startWhatsApp, 5000);
      }
      if (connection === 'open') {
        latestQR = null; // Clear QR on successful connection
        io.emit('whatsapp-connected');
        console.log('WhatsApp connection established.');
      }
    });

    // Listen for message status updates (emit only sent/failed)
    sock.ev.on('messages.update', (updates) => {
      updates.forEach(async (update) => {
        const { key, update: status, timestamp } = update;
        if (!key) return;
        if (status !== 'sent' && status !== 'failed') return; // Only filter

        const jid = key.remoteJid || 'unknown';
        const messageId = key.id || 'unknown';
        const fromMe = key.fromMe || false;

        const eventData = {
          messageId,
          recipient: jid,
          fromMe,
          status,
          time: timestamp ? new Date(timestamp * 1000).toLocaleString() : new Date().toLocaleString(),
        };

        console.log('Message status update:', eventData);

        io.emit('message-status-update', eventData);

        try {
          const mailOptions = {
            from: `"WhatsApp Automation" <${transporter.options.auth.user}>`,
            to: notifyEmail,
            subject: `WhatsApp Message ${status.toUpperCase()}: ${messageId}`,
            text: `Message ID: ${messageId}
Recipient: ${jid}
From Me: ${fromMe}
Status: ${status}
Time: ${eventData.time}`
          };

          await transporter.sendMail(mailOptions);
          console.log(`Sent status email for message ID: ${messageId}`);
        } catch (err) {
          console.error('Error sending status email:', err);
        }
      });
    });

  } catch (e) {
    console.error('Error in Baileys connection:', e);
  }
}

startWhatsApp();

// API endpoint to fetch current QR code (useful on page load)
app.get('/whatsapp-qr', (req, res) => {
  if (latestQR) res.json({ qr: latestQR });
  else res.status(404).json({ error: 'QR code not available. WhatsApp likely connected.' });
});

// CSV upload endpoint
app.post('/upload-csv', csvUpload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded. Please select a CSV file.' });

  const csvData = req.file.buffer.toString('utf-8');
  const records = [];
  let parseErrorSent = false;

  parse(csvData, {
    columns: (header) => {
      const normalized = header.map(normalizeHeader);
      const required = ['name', 'groupid', 'chatid'];
      for (const col of required) if (!normalized.includes(col)) throw new Error(`Missing required column: "${col}"`);
      return normalized;
    },
    skip_empty_lines: true,
    relax_column_count: true,
  })
  .on('error', (err) => {
    if (!parseErrorSent && !res.headersSent) {
      parseErrorSent = true;
      res.status(400).json({ error: err.message });
    }
  })
  .on('readable', function() {
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

// Send messages endpoint
app.post('/send-messages', imageUpload.single('image'), async (req, res) => {
  const { message, caption, joinLink, scheduleDateTime, recipients } = req.body;

  if (!message || !recipients)
    return res.status(400).json({ error: "Missing required fields: 'message' and 'recipients'." });

  let recipientList;
  try {
    recipientList = typeof recipients === 'string' ? JSON.parse(recipients) : recipients;
    if (!Array.isArray(recipientList) || recipientList.length === 0)
      return res.status(400).json({ error: "'recipients' must be a non-empty array." });
  } catch {
    return res.status(400).json({ error: "Failed to parse 'recipients' JSON." });
  }

  if (!sock || !sock.authState || !sock.user)
    return res.status(503).json({ error: "WhatsApp is not connected. Please scan QR code and wait." });

  let fullMsg = message;
  if (joinLink && joinLink.trim()) fullMsg += `\n\n${joinLink.trim()}`;

  let scheduled = false;
  let when = null;
  if (scheduleDateTime && scheduleDateTime.trim()) {
    when = new Date(scheduleDateTime);
    if (when < new Date()) return res.status(400).json({ error: "Schedule time cannot be past." });
    scheduled = true;
  }

  const sendMessages = async () => {
    for (const recipient of recipientList) {
      const jid = (recipient.group_id || recipient.chat_id || '').trim();
      if (!jid.endsWith('@g.us')) {
        console.warn(`Skipping invalid jid: ${jid}`);
        continue;
      }
      try {
        let msgInfo;
        if (req.file) {
          msgInfo = await sock.sendMessage(jid, {
            image: req.file.buffer,
            mimetype: req.file.mimetype,
            caption: caption ? `${caption}\n\n${fullMsg}` : fullMsg,
            jpegThumbnail: Buffer.alloc(0), // disables thumbnail generation errors
          });
          console.log(`Sent image message to ${jid}`);
        } else {
          msgInfo = await sock.sendMessage(jid, { text: fullMsg });
          console.log(`Sent text message to ${jid}`);
        }

        // Emit sent event immediately for frontend & email notifications
        io.emit('message-status-update', {
          messageId: msgInfo?.key?.id || 'unknown',
          recipient: jid,
          fromMe: true,
          status: 'sent',
          time: new Date().toLocaleString(),
        });

        // Optionally, send email notifications here also if you want

        await delay(1200);
      } catch (e) {
        console.error(`Failed to send message to ${jid}:`, e.message);

        io.emit('message-status-update', {
          messageId: 'unknown',
          recipient: jid,
          fromMe: true,
          status: 'failed',
          time: new Date().toLocaleString(),
        });

        // Optionally, send email notifications on failure here
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
    console.error('Error sending/scheduling:', error);
    res.status(500).json({ error: 'Internal server error while sending messages.' });
  }
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`WhatsApp Automation Backend listening on port ${PORT}`);
});
