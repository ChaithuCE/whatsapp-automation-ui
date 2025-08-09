import React, { useState, useEffect } from "react";
import axios from "axios";
import { io } from "socket.io-client";
import { QRCodeCanvas } from "qrcode.react";

function App() {
  // WhatsApp connection & QR
  const [wsConnected, setWsConnected] = useState(false);
  const [qrCode, setQrCode] = useState(null);
  const [showQr, setShowQr] = useState(false);

  // Message Log Modal
  const [logOpen, setLogOpen] = useState(false);

  // Real-time message statuses
  const [msgStatuses, setMsgStatuses] = useState([]);

  // Usual states
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

  // Socket.IO connect and event listeners
  useEffect(() => {
    const socket = io("http://localhost:5000");
    socket.on("connect", () => console.log("Socket.IO connected"));
    socket.on("whatsapp-qr", ({ qr }) => {
      setQrCode(qr);
      setShowQr(true);
      setWsConnected(false);
    });
    socket.on("whatsapp-connected", () => {
      setQrCode(null);
      setShowQr(false);
      setWsConnected(true);
    });
    socket.on("message-status-update", (data) => {
      setMsgStatuses((prev) => [data, ...prev].slice(0, 100));
    });
    return () => socket.disconnect();
  }, []);

  // CSV handling
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

  // Group select
  const toggleGroupSelection = (index) => {
    const newSet = new Set(selectedGroups);
    newSet.has(index) ? newSet.delete(index) : newSet.add(index);
    setSelectedGroups(newSet);
  };
  const selectAllGroups = () => setSelectedGroups(new Set(groups.map((_, i) => i)));
  const deselectAllGroups = () => setSelectedGroups(new Set());

  // Image preview
  const handleImageChange = (e) => {
    const img = e.target.files[0];
    setImage(img || null);
    setImageUrl(img ? URL.createObjectURL(img) : null);
  };

  // Send message
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

  // Message preview component
  const PreviewCard = () => {
    if (!message && !imageUrl && !joinLink && !caption && !scheduleDateTime) return null;
    return (
      <div style={{
        background: "#f8faff", borderRadius: 10, marginTop: 28, marginBottom: 30,
        padding: 24, boxShadow: "0 2px 12px #b9c8fa26", maxWidth: 530, fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", color: "#222"
      }}>
        <div style={{ fontWeight: 700, color: "#336", marginBottom: 8, letterSpacing: 1.1 }}>Preview Message:</div>
        <div style={{ marginBottom: 10, whiteSpace: "pre-wrap", fontSize: 17 }}>
          {message || <span style={{ color: "#aaa" }}>No message entered</span>}
        </div>
        {imageUrl && (
          <div style={{ marginBottom: 8 }}>
            <img src={imageUrl} alt="Preview"
              style={{ maxWidth: 340, maxHeight: 180, borderRadius: 5, border: "1px solid #bbe" }} />
            {caption && (
              <div style={{
                marginTop: 4, fontSize: 15, color: "#333", background: "#edf2ff",
                borderRadius: 5, padding: "5px 9px", display: "inline-block"
              }}>{caption}</div>
            )}
          </div>
        )}
        {joinLink && (
          <div style={{
            marginBottom: 8, fontSize: 15, color: "#226", display: "flex", alignItems: "center"
          }}>
            <span style={{
              background: "#f2ffe7", borderRadius: 4, padding: "2px 8px 2px 4px", marginRight: 10, fontWeight: 600
            }}>Meet Link:</span>
            <a href={joinLink} style={{ color: "#1574b7" }} target="_blank" rel="noopener noreferrer">
              {joinLink}
            </a>
          </div>
        )}
        {scheduleDateTime && (
          <div style={{
            color: "#638", fontSize: 15, fontFamily: "monospace", marginTop: 10
          }}>Schedule Time: {new Date(scheduleDateTime).toLocaleString()}
          </div>
        )}
      </div>
    );
  };

  // UI return
  return (
    <div style={{
      maxWidth: 1000, margin: "40px auto", padding: 24, background: "#f9fafc", borderRadius: 8,
      fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", color: "#222"
    }}>
      <h1 style={{ color: "#2a3d66", marginBottom: 22 }}>WhatsApp Group Messaging Automation</h1>

      {/* Section 1: WhatsApp Connect */}
      <div style={{ marginBottom: 28 }}>
        {!wsConnected && (
          <button
            style={{
              background: "#25d366", color: "#fff", padding: "14px 30px", fontWeight: "bold",
              border: "none", borderRadius: 7, fontSize: 18, cursor: "pointer"
            }}
            onClick={() => setShowQr(true)}
          >
            Connect to WhatsApp
          </button>
        )}
        {wsConnected && (
          <span style={{ color: "#388e3c", fontWeight: 700, fontSize: "1.2em" }}>
            ✅ WhatsApp Connected
          </span>
        )}
      </div>

      {/* WhatsApp QR Modal */}
      {(showQr || qrCode) && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
          background: "#000a", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 10000
        }}>
          <div style={{
            background: "#fff", padding: 25, borderRadius: 10,
            boxShadow: "0 2px 18px #0004", textAlign: "center"
          }}>
            <h3>Scan QR Code with WhatsApp</h3>
            {qrCode ? (
              <QRCodeCanvas value={qrCode} size={250} />
            ) : (
              <p style={{ color: "#888" }}>Waiting for QR code...</p>
            )}
            <button
              onClick={() => setShowQr(false)}
              style={{ marginTop: 18, padding: "8px 30px", borderRadius: 6, background: "#274078", color: "#fff", border: "none", cursor: "pointer" }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Section 2: Message Log Modal */}
      <button style={{
        position: "fixed", top: 20, right: 36, background: "#234", color: "#fff", zIndex: 10000,
        padding: "10px 22px", fontWeight: 600, border: "none", borderRadius: 7, fontSize: 15, boxShadow: "0 3px 10px #0002"
      }}
        onClick={() => setLogOpen(true)}
      >
        Show Message Log
      </button>
      {/* Message Log Modal */}
      {logOpen && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh",
          background: "#000a", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 10001
        }}>
          <div style={{
            background: "#fff", minWidth: 400, maxWidth: 700, minHeight: 350, maxHeight: "90vh",
            borderRadius: 10, padding: 30, boxShadow: "0 6px 36px #0004", overflowY: "auto", textAlign: "center"
          }}>
            <h3 style={{ color: "#357", marginBottom: 11 }}>Message Send Status Log</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "1rem" }}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Recipient</th>
                  <th>Status</th>
                  <th>From Me?</th>
                  <th>Message ID</th>
                </tr>
              </thead>
              <tbody>
                {msgStatuses.map((s, idx) => (
                  <tr key={s.messageId + idx} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "6px", fontSize: "0.98em" }}>{s.time}</td>
                    <td style={{ padding: "6px" }}>{s.recipient}</td>
                    <td style={{
                      padding: "6px", fontWeight: "bold",
                      color: s.status === "sent" ? "#388e3c" : (s.status === "failed" ? "#d32f2f" : "#234")
                    }}>
                      {s.status}
                    </td>
                    <td>{s.fromMe ? "Yes" : "No"}</td>
                    <td style={{ fontSize: "0.85em", color: "#888" }}>{s.messageId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              style={{ marginTop: 18, padding: "8px 30px", borderRadius: 6, background: "#333", color: "#fff", border: "none", cursor: "pointer" }}
              onClick={() => setLogOpen(false)}
            >Close</button>
          </div>
        </div>
      )}

      {/* Section 3: CSV Upload, Message Compose, Preview, Controls */}
      {/* Disable upload/message IF not connected */}
      <form onSubmit={handleUpload} style={{ marginBottom: 24, opacity: wsConnected ? 1 : 0.49, pointerEvents: wsConnected ? undefined : "none" }}>
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
            cursor: wsConnected ? "pointer" : "not-allowed",
            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          }}
        >
          Upload & Show All Groups
        </button>
      </form>
      {uploadError && (
        <p style={{ color: "red", fontWeight: 600, marginBottom: 24 }}>{uploadError}</p>
      )}

      {groups.length > 0 && (
        <>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>
            Total Groups: {totalGroups}
            <button onClick={selectAllGroups} style={{ marginLeft: 16, cursor: "pointer" }}>Select All</button>
            <button onClick={deselectAllGroups} style={{ marginLeft: 12, cursor: "pointer" }}>Deselect All</button>
          </div>
          <div style={{
            maxHeight: 300, overflowY: "scroll", border: "1px solid #ccc",
            borderRadius: 6, padding: 10, backgroundColor: "#fff", marginBottom: 18,
          }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "1rem" }}>
              <thead>
                <tr>
                  <th style={{ padding: 6 }}></th>
                  {["name", "group_id", "chat_id"].map((header) => (
                    <th key={header} style={{
                      borderBottom: "2px solid #2a3d66",
                      backgroundColor: "#e9eef8",
                      textAlign: "left",
                      padding: "8px 12px",
                      fontWeight: 600,
                      position: "sticky",
                      top: 0,
                      zIndex: 1,
                      textTransform: "capitalize",
                    }}>
                      {header.replace(/_/g, " ")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((group, idx) => (
                  <tr key={idx} style={{
                    borderBottom: idx === groups.length - 1 ? "none" : "1px solid #e3e6f0",
                  }}>
                    <td style={{ padding: "8px", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={selectedGroups.has(idx)}
                        onChange={() => toggleGroupSelection(idx)}
                      />
                    </td>
                    <td style={{ padding: "8px" }}>{group.name || ""}</td>
                    <td style={{ padding: "8px" }}>{group.group_id || ""}</td>
                    <td style={{ padding: "8px" }}>{group.chat_id || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selectedGroupData.length > 0 && (
        <div style={{
          border: "1px solid #e1e3f1", background: "#fcfdff", borderRadius: 6,
          marginBottom: 20, boxShadow: "0 1px 7px #dbe5ff29"
        }}>
          <div style={{
            fontWeight: 700, fontSize: 15, color: "#354888", padding: "8px 10px"
          }}>
            Selected Groups ({selectedGroupData.length})
          </div>
          <table style={{
            width: "100%", borderCollapse: "collapse", fontSize: "1rem",
            background: "#fcfdff"
          }}>
            <thead>
              <tr>
                {["name", "group_id", "chat_id"].map((header) => (
                  <th key={header} style={{
                    padding: "7px 6px",
                    color: "#2a3d66",
                    fontWeight: 600,
                    borderBottom: "1px solid #d2d8ef",
                    textTransform: "capitalize",
                    background: "#f2f7ff",
                  }}>
                    {header.replace(/_/g, " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selectedGroupData.map((group, idx) => (
                <tr key={idx}>
                  <td style={{ padding: "6px 8px" }}>{group.name || ""}</td>
                  <td style={{ padding: "6px 8px" }}>{group.group_id || ""}</td>
                  <td style={{ padding: "6px 8px" }}>{group.chat_id || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Message compose/preview UI */}
      <div style={{ display: "flex", gap: 48, flexWrap: "wrap", opacity: wsConnected ? 1 : 0.49, pointerEvents: wsConnected ? undefined : "none" }}>
        <div style={{ minWidth: 330, flex: "1 0 300px" }}>
          <div style={{ marginBottom: 20 }}>
            <label htmlFor="message" style={{ fontWeight: 600, color: "#333" }}>
              WhatsApp Message:
            </label>
            <textarea
              id="message"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              style={{
                width: "100%",
                padding: 10,
                fontSize: "1rem",
                marginTop: 6,
                resize: "vertical",
              }}
              placeholder="Enter your message here"
            />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label htmlFor="image" style={{ fontWeight: 600, color: "#333" }}>
              Attach Image (optional):
            </label>
            <input
              type="file"
              id="image"
              accept="image/*"
              onChange={handleImageChange}
              style={{ marginLeft: 10, marginTop: 6 }}
            />
            <input
              type="text"
              id="caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Image caption (optional)"
              style={{ width: 230, marginLeft: 14, fontSize: "1rem", padding: 6 }}
            />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label htmlFor="joinLink" style={{ fontWeight: 600, color: "#333" }}>
              Zoom/Google Meet Link (optional):
            </label>
            <input
              type="text"
              id="joinLink"
              value={joinLink}
              onChange={(e) => setJoinLink(e.target.value)}
              placeholder="https://meet.google.com/..."
              style={{ width: 330, marginLeft: 10, fontSize: "1rem", padding: 6 }}
            />
          </div>
          <div style={{ marginBottom: 24 }}>
            <label htmlFor="schedule" style={{ fontWeight: 600, color: "#333" }}>
              Schedule Date & Time (optional):
            </label>
            <input
              type="datetime-local"
              id="schedule"
              value={scheduleDateTime}
              onChange={(e) => setScheduleDateTime(e.target.value)}
              style={{ width: "250px", display: "block", marginTop: 6, padding: 6, fontSize: "1rem" }}
            />
          </div>
        </div>
        <div style={{ flex: "1 0 350px" }}>
          <PreviewCard />
        </div>
      </div>

      <button
        onClick={handleSend}
        disabled={sending || groups.length === 0 || !wsConnected}
        style={{
          padding: "10px 30px",
          borderRadius: 6,
          fontSize: 16,
          background: sending ? "#888" : "#274078",
          color: "white",
          border: "none",
          cursor: sending ? "not-allowed" : (groups.length === 0 || !wsConnected) ? "not-allowed" : "pointer",
          boxShadow: "0 2px 6px rgba(0,0,0,0.16)",
          marginTop: 14,
        }}
      >
        {sending ? "Sending..." : "Send / Schedule Messages"}
      </button>
      {sendSuccess && (
        <p style={{ color: "green", marginTop: 20, fontWeight: 600 }}>{sendSuccess}</p>
      )}
      {sendError && (
        <p style={{ color: "red", marginTop: 20, fontWeight: 600 }}>{sendError}</p>
      )}
    </div>
  );
}

export default App;
