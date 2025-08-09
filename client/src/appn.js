import React, { useState, useEffect } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { QRCodeCanvas } from "qrcode.react";

function App() {
  const [file, setFile] = useState(null);
  const [groups, setGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState(new Set());
  const [totalGroups, setTotalGroups] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [image, setImage] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [caption, setCaption] = useState("");
  const [joinLink, setJoinLink] = useState("");
  const [message, setMessage] = useState("");
  const [scheduleDateTime, setScheduleDateTime] = useState("");
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState("");
  const [sendError, setSendError] = useState("");

  // Real-time status updates state
  const [msgStatuses, setMsgStatuses] = useState([]);

  // WhatsApp QR code & socket state
  const [qrCode, setQrCode] = useState(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);

  useEffect(() => {
    const socket = io("http://localhost:5000");

    socket.on("connect", () => {
      console.log("Socket.IO connected to backend");
    });

    // Listen for QR code
    socket.on("whatsapp-qr", ({ qr }) => {
      setQrCode(qr);
      setQrModalOpen(true);
    });

    // WhatsApp connected
    socket.on("whatsapp-connected", () => {
      setQrCode(null);
      setQrModalOpen(false);
      alert("WhatsApp connected successfully!");
    });

    // Listen for message status updates
    socket.on("message-status-update", (data) => {
      setMsgStatuses((prev) => [data, ...prev].slice(0, 100));
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected");
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // CSV Upload handler
  const handleFileChange = (e) => {
    const f = e.target.files[0];
    setFile(f);
    setGroups([]);
    setSelectedGroups(new Set());
    setTotalGroups(0);
    setUploadError("");
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    setSendSuccess("");
    setSendError("");

    if (!file) {
      setUploadError("Please select a CSV file first.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await axios.post("http://localhost:5000/upload-csv", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setGroups(res.data.previewGroups);
      setTotalGroups(res.data.totalGroups);
      setSelectedGroups(new Set());
      setUploadError("");
    } catch (err) {
      setUploadError(err.response?.data?.error || "Failed to upload or parse CSV.");
      setGroups([]);
      setTotalGroups(0);
    }
  };

  const toggleGroupSelection = (index) => {
    const newSet = new Set(selectedGroups);
    newSet.has(index) ? newSet.delete(index) : newSet.add(index);
    setSelectedGroups(newSet);
  };

  const selectAllGroups = () => setSelectedGroups(new Set(groups.map((_, i) => i)));
  const deselectAllGroups = () => setSelectedGroups(new Set());

  const handleImageChange = (e) => {
    const img = e.target.files[0];
    setImage(img || null);
    if (img) {
      setImageUrl(URL.createObjectURL(img));
    } else {
      setImageUrl(null);
    }
  };

  const handleSend = async () => {
    setSendSuccess("");
    setSendError("");

    if (selectedGroups.size === 0) {
      setSendError("Please select at least one group.");
      return;
    }
    if (!message.trim()) {
      setSendError("Please enter the WhatsApp message.");
      return;
    }

    const formData = new FormData();
    formData.append("message", message.trim());
    formData.append("caption", caption);
    formData.append("joinLink", joinLink);
    formData.append("scheduleDateTime", scheduleDateTime || "");
    formData.append(
      "recipients",
      JSON.stringify(Array.from(selectedGroups).map((i) => groups[i]))
    );
    if (image) formData.append("image", image);

    try {
      setSending(true);
      const res = await axios.post("http://localhost:5000/send-messages", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setSendSuccess(res.data.message || "Messages scheduled/sent!");
      setSendError("");
      setSending(false);
    } catch (err) {
      setSendError(err.response?.data?.error || "Failed to send messages.");
      setSendSuccess("");
      setSending(false);
    }
  };

  const selectedGroupData = Array.from(selectedGroups).map((idx) => groups[idx]);

  const PreviewCard = () => {
    if (!message && !imageUrl && !joinLink && !caption && !scheduleDateTime) return null;

    return (
      <div
        style={{
          background: "#f8faff",
          borderRadius: 10,
          marginTop: 28,
          marginBottom: 30,
          padding: 24,
          boxShadow: "0 2px 12px #b9c8fa26",
          maxWidth: 530,
          fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
          color: "#222",
        }}
      >
        <div style={{ fontWeight: 700, color: "#336", marginBottom: 8, letterSpacing: 1.1 }}>
          Preview Message:
        </div>
        <div style={{ marginBottom: 10, whiteSpace: "pre-wrap", fontSize: 17 }}>
          {message || <span style={{ color: "#aaa" }}>No message entered</span>}
        </div>
        {imageUrl && (
          <div style={{ marginBottom: 8 }}>
            <img
              src={imageUrl}
              alt="Preview"
              style={{ maxWidth: 340, maxHeight: 180, borderRadius: 5, border: "1px solid #bbe" }}
            />
            {caption && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 15,
                  color: "#333",
                  background: "#edf2ff",
                  borderRadius: 5,
                  padding: "5px 9px",
                  display: "inline-block",
                }}
              >
                {caption}
              </div>
            )}
          </div>
        )}
        {joinLink && (
          <div style={{ marginBottom: 8, fontSize: 15, color: "#226", display: "flex", alignItems: "center" }}>
            <span
              style={{
                background: "#f2ffe7",
                borderRadius: 4,
                padding: "2px 8px 2px 4px",
                marginRight: 10,
                fontWeight: 600,
              }}
            >
              Meet Link:
            </span>
            <a href={joinLink} style={{ color: "#1574b7" }} target="_blank" rel="noopener noreferrer">
              {joinLink}
            </a>
          </div>
        )}
        {scheduleDateTime && (
          <div style={{ color: "#638", fontSize: 15, fontFamily: "monospace", marginTop: 10 }}>
            Schedule Time: {new Date(scheduleDateTime).toLocaleString()}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 1000, margin: "40px auto", padding: 24, background: "#f9fafc", borderRadius: 8, color: "#222" }}>
      <h1 style={{ color: "#2a3d66", marginBottom: 22 }}>
        WhatsApp Group Messaging Automation
      </h1>

      <button
        style={{
          marginBottom: 20,
          background: "#25d366",
          color: "#fff",
          padding: "12px 24px",
          fontWeight: "bold",
          border: "none",
          borderRadius: 7,
          fontSize: 18,
          cursor: "pointer",
        }}
        onClick={() => setQrModalOpen(true)}
      >
        Connect to WhatsApp
      </button>

      {/* QR Modal */}
      {qrModalOpen && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
          background: "#000a", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 10000
        }}>
          <div style={{
            background: "#fff", padding: 30, borderRadius: 10, textAlign: "center",
          }}>
            <h3>Scan QR Code with WhatsApp</h3>
            {qrCode ? (
              <QRCodeCanvas value={qrCode} size={250} />
            ) : (
              <p>Waiting for QR code...</p>
            )}
            <button
              style={{ marginTop: 20, padding: "8px 20px", borderRadius: 6, background: "#274078", color: "#fff", border: "none", cursor: "pointer" }}
              onClick={() => setQrModalOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* The rest of your UI components like CSV upload form, groups, inputs, preview */}

      {/* CSV Upload form */}
      <form onSubmit={handleUpload} style={{ marginBottom: 24 }}>
        <label htmlFor="csvFile" style={{ fontWeight: 600, fontSize: 16 }}>
          Upload Groups CSV File:
        </label>
        <br />
        <input
          type="file"
          accept=".csv"
          id="csvFile"
          onChange={handleFileChange}
          style={{ marginTop: 10, marginBottom: 20, fontSize: "1rem", padding: 6, maxWidth: 400, width: "100%" }}
        />
        <br />
        <button
          type="submit"
          style={{
            padding: "10px 25px",
            borderRadius: 6,
            fontSize: 16,
            background: "#2a3d66",
            color: "white",
            border: "none",
            cursor: "pointer",
            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          }}
        >
          Upload & Show All Groups
        </button>
      </form>

      {/* Existing groups, inputs, message preview (your current UI) here... */}
      {/* ... (same as your existing UI code above) */}

      {/* Real-time message status updates */}
      {msgStatuses.length > 0 && (
        <div
          style={{
            marginTop: 30,
            background: "#fcfaff",
            padding: 16,
            borderRadius: 8,
            boxShadow: "0 3px 14px #e6e7fd44",
            fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
          }}
        >
          <h3 style={{ marginBottom: 10, color: "#456" }}>
            Recent WhatsApp Message Status Updates:
          </h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "1rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "5px" }}>Time</th>
                <th style={{ textAlign: "left", padding: "5px" }}>Recipient</th>
                <th style={{ textAlign: "left", padding: "5px" }}>Status</th>
                <th style={{ textAlign: "left", padding: "5px" }}>From Me?</th>
                <th style={{ textAlign: "left", padding: "5px" }}>Message ID</th>
              </tr>
            </thead>
            <tbody>
              {msgStatuses.map((s, idx) => (
                <tr key={s.messageId + idx} style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "5px" }}>{s.time}</td>
                  <td style={{ padding: "5px" }}>{s.recipient}</td>
                  <td style={{ padding: "5px", textTransform: "capitalize" }}>{s.status}</td>
                  <td style={{ padding: "5px" }}>{s.fromMe ? "Yes" : "No"}</td>
                  <td style={{ padding: "5px", fontSize: "0.85em", color: "#888", wordBreak: "break-word" }}>
                    {s.messageId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default App;
