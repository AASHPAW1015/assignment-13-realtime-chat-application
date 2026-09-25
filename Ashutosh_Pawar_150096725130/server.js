require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");
const registerChatHandlers = require("./sockets/chatHandler");
const registerUserHandlers = require("./sockets/userHandler");
const { listRooms } = require("./utils/messageStore");

const app = express();

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/rooms", (request, response) => {
  response.status(200).json({ rooms: listRooms() });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// socketId -> { username, avatar, currentRoom }
const connectedUsers = new Map();

io.on("connection", (socket) => {
  console.log(`socket connected: ${socket.id}`);
  // chat handler owns the typing timers; user handler needs to clear them on leave
  const stopTyping = registerChatHandlers(io, socket, connectedUsers);
  registerUserHandlers(io, socket, connectedUsers, stopTyping);
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`chat server is running on port ${PORT}!!`);
});
