const crypto = require("crypto");
const { addMessageToHistory } = require("../utils/messageStore");

const MAX_LENGTH = 1000;
// if a client never sends typing:stop (tab closed mid-word), clear it anyway
const TYPING_TIMEOUT_MS = 5000;

function clock() {
  return new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function cleanMessage(message) {
  return String(message ?? "").trim().slice(0, MAX_LENGTH);
}

function registerChatHandlers(io, socket, connectedUsers) {
  const typingTimers = {};

  function stopTyping(room) {
    if (!typingTimers[room]) return;
    clearTimeout(typingTimers[room]);
    delete typingTimers[room];
    const user = connectedUsers.get(socket.id);
    socket.to(room).emit("typing:update", { username: user ? user.username : "", isTyping: false });
  }

  // only a logged-in user who is actually inside the room may talk in it
  function memberOf(room) {
    const user = connectedUsers.get(socket.id);
    return user && room && socket.rooms.has(room) ? user : null;
  }

  socket.on("chat:send", ({ room, message } = {}) => {
    const user = memberOf(room);
    if (!user) return socket.emit("chat:error", { message: "Join the room before sending" });

    const text = cleanMessage(message);
    if (!text) return;

    stopTyping(room);
    const messageObj = {
      id: `msg_${crypto.randomUUID().slice(0, 8)}`,
      room,
      sender: user.username,
      avatar: user.avatar,
      message: text,
      timestamp: clock(),
    };
    addMessageToHistory(room, messageObj);
    io.to(room).emit("chat:receive", messageObj);
  });

  socket.on("typing:start", ({ room } = {}) => {
    const user = memberOf(room);
    if (!user) return;

    // broadcast only on the first start; later ones just push the timeout back
    if (!typingTimers[room]) {
      socket.to(room).emit("typing:update", { username: user.username, isTyping: true });
    }
    clearTimeout(typingTimers[room]);
    typingTimers[room] = setTimeout(() => stopTyping(room), TYPING_TIMEOUT_MS);
  });

  socket.on("typing:stop", ({ room } = {}) => {
    stopTyping(room);
  });

  socket.on("direct:send", ({ recipientId, message } = {}) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return socket.emit("chat:error", { message: "Log in first" });

    const recipient = connectedUsers.get(recipientId);
    if (!recipient) return socket.emit("chat:error", { message: "That user is offline" });
    if (recipientId === socket.id) return socket.emit("chat:error", { message: "You cannot DM yourself" });

    const text = cleanMessage(message);
    if (!text) return;

    const timestamp = clock();
    // io.to(socketId) -> only the recipient's socket, nobody else in any room
    io.to(recipientId).emit("direct:receive", {
      fromId: socket.id,
      from: user.username,
      message: text,
      timestamp,
    });
    // echo to the sender so their DM thread shows it too
    socket.emit("direct:sent", { toId: recipientId, to: recipient.username, message: text, timestamp });
  });

  socket.on("disconnect", () => {
    Object.keys(typingTimers).forEach((room) => clearTimeout(typingTimers[room]));
  });

  return stopTyping;
}

module.exports = registerChatHandlers;
