const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const port = Number(process.env.PORT || 8080);
const publicDir = __dirname;
const rooms = new Map();
const clients = new Map();
const typingUsers = new Map();
const appBasePath = "/secretchat";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/") {
    response.writeHead(308, { Location: `${appBasePath}/${url.search}` });
    response.end();
    return;
  }
  if (url.pathname === appBasePath) {
    response.writeHead(308, { Location: `${appBasePath}/${url.search}` });
    response.end();
    return;
  }
  if (!url.pathname.startsWith(`${appBasePath}/`)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const pathname = url.pathname.slice(appBasePath.length);

  if (pathname === "/api/rooms" && request.method === "POST") {
    const body = await readJson(request);
    const roomName = cleanText(body.name, 32);
    const userName = cleanText(body.userName, 24);

    if (!roomName || !userName) {
      sendJson(response, 400, { message: "Name and room name are required." });
      return;
    }

    const code = createRoomCode();
    const room = {
      code,
      name: roomName,
      owner: userName,
      members: [userName],
      messages: [
        createMessage("system", `${userName} created ${roomName}.`),
        createMessage("system", `Secret code ${code} is required to join this room.`)
      ]
    };

    rooms.set(code, room);
    sendJson(response, 201, { room });
    return;
  }

  const joinMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/join$/);
  if (joinMatch && request.method === "POST") {
    const code = normalizeCode(joinMatch[1]);
    const room = rooms.get(code);
    const body = await readJson(request);
    const userName = cleanText(body.userName, 24);
    const resume = body.resume === true;

    if (!room) {
      sendJson(response, 404, { message: "No room found with that secret code." });
      return;
    }

    if (!userName) {
      sendJson(response, 400, { message: "Name is required." });
      return;
    }

    room.members ||= [room.owner];
    if (resume) {
      sendJson(response, 200, { room });
      return;
    }

    const joinedAt = new Date().toISOString();
    room.messages.push(createMessage("system", `${userName} joined ${room.name}.`));
    broadcastRoom(room);
    sendJson(response, 200, { room: { ...room, messages: [] }, joinedAt });
    return;
  }

  const messageMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/messages$/);
  if (messageMatch && request.method === "POST") {
    const code = normalizeCode(messageMatch[1]);
    const room = rooms.get(code);
    const body = await readJson(request);
    const author = cleanText(body.author, 24);
    const text = cleanText(body.text, 280);
    const image = cleanImage(body.image);
    const replyTo = cleanReply(body.replyTo);

    if (!room) {
      sendJson(response, 404, { message: "Room not found." });
      return;
    }

    if (!author || (!text && !image)) {
      sendJson(response, 400, { message: "Author and message are required." });
      return;
    }

    room.messages.push(createMessage(author, text, { image, replyTo }));
    broadcastRoom(room);
    sendJson(response, 201, { room });
    return;
  }

  const clearMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/clear$/);
  if (clearMatch && request.method === "POST") {
    const code = normalizeCode(clearMatch[1]);
    const room = rooms.get(code);
    const body = await readJson(request);
    const userName = cleanText(body.userName, 24);

    if (!room) {
      sendJson(response, 404, { message: "Room not found." });
      return;
    }

    room.messages = [createMessage("system", `${userName || "Someone"} cleared the chat.`)];
    broadcastRoom(room);
    sendJson(response, 200, { room });
    return;
  }

  const typingMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/typing$/);
  if (typingMatch && request.method === "POST") {
    const code = normalizeCode(typingMatch[1]);
    const room = rooms.get(code);
    const body = await readJson(request);
    const userName = cleanText(body.userName, 24);
    const clientId = cleanText(body.clientId, 80);

    if (!room) {
      sendJson(response, 404, { message: "Room not found." });
      return;
    }
    if (!userName || !clientId) {
      sendJson(response, 400, { message: "Name and client are required." });
      return;
    }

    if (!typingUsers.has(code)) typingUsers.set(code, new Map());
    const roomTypingUsers = typingUsers.get(code);
    if (body.isTyping) roomTypingUsers.set(clientId, userName);
    else roomTypingUsers.delete(clientId);
    broadcastTyping(code);
    sendJson(response, 200, { ok: true });
    return;
  }

  const eventsMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/events$/);
  if (eventsMatch && request.method === "GET") {
    const code = normalizeCode(eventsMatch[1]);
    const room = rooms.get(code);

    if (!room) {
      response.writeHead(404);
      response.end();
      return;
    }

    if (!clients.has(code)) {
      clients.set(code, new Set());
    }

    response.typingClientId = cleanText(url.searchParams.get("clientId"), 80);
    response.typingUserName = cleanText(url.searchParams.get("userName"), 24);
    room.members ||= [room.owner];
    const memberAdded = response.typingUserName && !room.members.includes(response.typingUserName);
    if (memberAdded) room.members.push(response.typingUserName);
    clients.get(code).add(response);
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    response.write(`event: room\ndata: ${JSON.stringify(room)}\n\n`);
    if (memberAdded) broadcastRoom(room);
    response.on("close", () => {
      clients.get(code).delete(response);
      const stillConnected = Array.from(clients.get(code) || []).some((client) => client.typingUserName === response.typingUserName);
      if (response.typingUserName && !stillConnected) {
        room.members = room.members.filter((name) => name !== response.typingUserName);
        broadcastRoom(room);
      }
      if (response.typingClientId && typingUsers.get(code)?.delete(response.typingClientId)) {
        broadcastTyping(code);
      }
    });
    return;
  }

  serveStatic(pathname, response);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Arcane Chat running at http://localhost:${port}/secretchat`);
});

function broadcastRoom(room) {
  const roomClients = clients.get(room.code);

  if (!roomClients) {
    return;
  }

  for (const client of roomClients) {
    client.write(`event: room\ndata: ${JSON.stringify(room)}\n\n`);
  }
}

function broadcastTyping(code) {
  const roomClients = clients.get(code);
  const users = Array.from(typingUsers.get(code) || [], ([id, name]) => ({ id, name }));
  if (!roomClients) return;
  for (const client of roomClients) {
    client.write(`event: typing\ndata: ${JSON.stringify({ users })}\n\n`);
  }
}

function createRoomCode() {
  let code = "";

  do {
    code = `${randomToken(3)}-${crypto.randomInt(100, 1000)}-${randomToken(2)}`;
  } while (rooms.has(code));

  return code;
}

function randomToken(length) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let token = "";

  for (let index = 0; index < length; index += 1) {
    token += alphabet[crypto.randomInt(0, alphabet.length)];
  }

  return token;
}

function createMessage(author, text, options = {}) {
  return {
    id: crypto.randomUUID(),
    author,
    text,
    image: options.image || null,
    replyTo: options.replyTo || null,
    createdAt: new Date().toISOString()
  };
}

function normalizeCode(code) {
  return decodeURIComponent(code).trim().toUpperCase();
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function cleanReply(replyTo) {
  if (!replyTo || typeof replyTo !== "object") {
    return null;
  }

  const id = cleanText(replyTo.id, 80);
  const author = cleanText(replyTo.author, 24);
  const text = cleanText(replyTo.text, 120);

  if (!id || !author || !text) {
    return null;
  }

  return { id, author, text };
}

function cleanImage(image) {
  if (!image || typeof image !== "object") {
    return null;
  }

  const name = cleanText(image.name, 80);
  const type = cleanText(image.type, 40);
  const data = typeof image.data === "string" ? image.data : "";
  const isImage = type.startsWith("image/") && data.startsWith(`data:${type};base64,`);
  const maxLength = 2.8 * 1024 * 1024;

  if (!isImage || data.length > maxLength) {
    return null;
  }

  return { name, type, data };
}

function readJson(request) {
  return new Promise((resolve) => {
    let body = "";
    const maxBodyLength = 4 * 1024 * 1024;
    let tooLarge = false;

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBodyLength) {
        tooLarge = true;
        request.destroy();
        resolve({});
      }
    });

    request.on("end", () => {
      if (tooLarge) {
        return;
      }

      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function serveStatic(urlPath, response) {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(content);
  });
}
