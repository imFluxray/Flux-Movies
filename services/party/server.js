"use strict";

/*
 * Flux watch parties.
 *
 * Rooms live in memory, so a restart ends every party - acceptable for
 * something this short-lived. The host's player is the source of truth: it
 * reports its position every couple of seconds and on every play, pause or
 * seek, and guests steer their own players towards it. Everyone must be signed
 * in to Flux, and display names come from that account as verified by the
 * account server, never from what the client claims.
 *
 * Served behind Caddy at /party (prefix stripped): GET/POST /api/rooms,
 * GET /api/rooms/:code, and the WebSocket at /ws.
 */

const crypto = require("node:crypto");
const http = require("node:http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8095);
const SSO_VERIFY_URL =
  process.env.SSO_VERIFY_URL || "https://web.flux.focuznow.com/api/sso/verify";
/*
 * The account server answers "bad origin" to anything whose Origin is not one
 * of its known applications - a browser sends that header, a server does not.
 * We are acting for the Movies site, so we say so.
 */
const SSO_ORIGIN = process.env.SSO_ORIGIN || "https://watch.flux.focuznow.com";

const MAX_ROOMS = 200;
const MAX_MEMBERS = 50;
const MAX_CHAT_HISTORY = 60;
const MAX_CHAT_LENGTH = 300;
const CHAT_GAP_MS = 600;
const MAX_MESSAGES_PER_SECOND = 25;
// a host refresh or network blip must not end the party for everyone
const HOST_GRACE_MS = 90 * 1000;
const HELLO_TIMEOUT_MS = 10 * 1000;
const TOKEN_CACHE_MS = 5 * 60 * 1000;
// no 0/O or 1/I, so a code read out loud cannot be mistyped
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const rooms = new Map();
const tokenCache = new Map();

async function verifyToken(token) {
  if (typeof token !== "string" || !token || token.length > 4096) return null;
  const cached = tokenCache.get(token);
  if (cached && Date.now() - cached.at < TOKEN_CACHE_MS) return cached.user;
  try {
    const res = await fetch(SSO_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Origin: SSO_ORIGIN,
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const profile = payload && payload.profile;
    if (!profile || typeof profile.username !== "string") return null;
    const user = {
      id: String(profile.id),
      name: profile.username.slice(0, 40),
      avatarSeed: Number(profile.avatarSeed) || 0,
    };
    tokenCache.set(token, { user, at: Date.now() });
    if (tokenCache.size > 5000) tokenCache.delete(tokenCache.keys().next().value);
    return user;
  } catch {
    return null;
  }
}

function newCode() {
  let code;
  do {
    code = Array.from(
      crypto.randomBytes(6),
      (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length],
    ).join("");
  } while (rooms.has(code));
  return code;
}

function cleanMedia(raw) {
  if (!raw || typeof raw !== "object") return null;
  const path = typeof raw.path === "string" ? raw.path : "";
  // only ever a Flux player route; guests navigate straight to it
  if (!/^\/media\/[^\s?#<>"'\\]+$/.test(path) || path.length > 300) return null;
  const poster =
    typeof raw.poster === "string" &&
    raw.poster.startsWith("https://image.tmdb.org/") &&
    raw.poster.length < 300
      ? raw.poster
      : null;
  return {
    path,
    title: typeof raw.title === "string" ? raw.title.slice(0, 200) : "Untitled",
    poster,
    episodeLabel:
      typeof raw.episodeLabel === "string" ? raw.episodeLabel.slice(0, 60) : null,
  };
}

/** The host's position as of now, extrapolated while playing. */
function currentTime(room) {
  if (room.state.paused) return room.state.time;
  return room.state.time + (Date.now() - room.state.at) / 1000;
}

function hostPresent(room) {
  return [...room.members.values()].some((member) => member.isHost);
}

function memberList(room) {
  // one entry per person, however many tabs they have open
  const people = new Map();
  room.members.forEach((member) => {
    if (!people.has(member.id) || member.isHost) people.set(member.id, { ...member });
  });
  return [...people.values()].sort(
    (a, b) => Number(b.isHost) - Number(a.isHost) || a.name.localeCompare(b.name),
  );
}

function summary(room) {
  return {
    code: room.code,
    isPublic: room.isPublic,
    hostName: room.hostName,
    title: room.media.title,
    poster: room.media.poster,
    episodeLabel: room.media.episodeLabel,
    media: room.media,
    watching: memberList(room).length,
    startedAt: room.createdAt,
  };
}

function send(socket, message) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function broadcast(room, message, except) {
  const data = JSON.stringify(message);
  room.members.forEach((_member, socket) => {
    if (socket !== except && socket.readyState === 1) socket.send(data);
  });
}

function pushChat(room, entry) {
  room.chat.push(entry);
  if (room.chat.length > MAX_CHAT_HISTORY) room.chat.shift();
  broadcast(room, { type: "chat", message: entry });
}

function systemChat(room, text) {
  pushChat(room, {
    id: crypto.randomUUID(),
    name: "",
    text,
    at: Date.now(),
    isHost: false,
    system: true,
  });
}

function closeRoom(room, reason) {
  if (!rooms.has(room.code)) return;
  rooms.delete(room.code);
  clearTimeout(room.closeTimer);
  broadcast(room, { type: "ended", reason });
  room.members.forEach((_member, socket) => socket.close(4000, "party ended"));
}

function scheduleCleanup(room) {
  clearTimeout(room.closeTimer);
  if (hostPresent(room)) return;
  room.closeTimer = setTimeout(
    () => closeRoom(room, "The host left the party"),
    HOST_GRACE_MS,
  );
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 16 * 1024) {
        req.destroy();
        resolve(null);
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

async function createRoom(req, res) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = await verifyToken(token);
  if (!user) return json(res, 401, { error: "Sign in to Flux to host a party" });
  const body = await readBody(req);
  const media = cleanMedia(body && body.media);
  if (!media) return json(res, 400, { error: "Start a party from a title's player" });

  // one party per host: starting another replaces the old one
  rooms.forEach((room) => {
    if (room.hostId === user.id) closeRoom(room, "The host started a new party");
  });
  if (rooms.size >= MAX_ROOMS)
    return json(res, 503, { error: "Too many parties right now - try again soon" });

  const code = newCode();
  const hostKey = crypto.randomBytes(24).toString("base64url");
  const startAt = Number(body && body.time);
  const room = {
    code,
    hostKey,
    hostId: user.id,
    hostName: user.name,
    isPublic: Boolean(body && body.isPublic),
    media,
    state: { time: Number.isFinite(startAt) && startAt > 0 ? startAt : 0, paused: true, at: Date.now() },
    members: new Map(),
    chat: [],
    createdAt: Date.now(),
    closeTimer: null,
  };
  rooms.set(code, room);
  // closes again unless the host actually connects
  scheduleCleanup(room);
  return json(res, 201, { code, hostKey });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://party.local");
  const path = url.pathname.replace(/\/+$/, "");

  if (req.method === "GET" && path === "/health")
    return json(res, 200, { ok: true, rooms: rooms.size });

  if (req.method === "GET" && path === "/api/rooms") {
    const list = [...rooms.values()]
      .filter((room) => room.isPublic && hostPresent(room))
      .map(summary)
      .sort((a, b) => b.watching - a.watching || b.startedAt - a.startedAt);
    return json(res, 200, { rooms: list });
  }

  const match = /^\/api\/rooms\/([A-Za-z0-9]{6})$/.exec(path);
  if (req.method === "GET" && match) {
    const room = rooms.get(match[1].toUpperCase());
    return room
      ? json(res, 200, { room: summary(room) })
      : json(res, 404, { error: "No party with that code" });
  }

  if (req.method === "POST" && path === "/api/rooms") {
    createRoom(req, res).catch(() => json(res, 500, { error: "Could not start the party" }));
    return undefined;
  }

  return json(res, 404, { error: "Not found" });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://party.local");
  if (pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
});

wss.on("connection", (ws) => {
  let room = null;
  let member = null;
  let joining = false;
  let lastChatAt = 0;
  let windowStart = Date.now();
  let windowCount = 0;
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  const helloTimer = setTimeout(() => ws.close(4001, "no hello"), HELLO_TIMEOUT_MS);

  const join = async (message) => {
    joining = true;
    clearTimeout(helloTimer);
    const code = String(message.code || "").toUpperCase();
    const user = await verifyToken(message.token);
    if (!user) {
      send(ws, { type: "error", error: "Sign in to Flux to join a party" });
      ws.close(4003, "unauthorised");
      return;
    }
    const target = rooms.get(code);
    if (!target || ws.readyState !== 1) {
      send(ws, { type: "error", error: "That party has ended or never existed" });
      ws.close(4004, "no room");
      return;
    }
    const isHost =
      typeof message.hostKey === "string" &&
      message.hostKey === target.hostKey &&
      user.id === target.hostId;
    const alreadyIn = memberList(target).some((person) => person.id === user.id);
    if (!isHost && !alreadyIn && memberList(target).length >= MAX_MEMBERS) {
      send(ws, { type: "error", error: "This party is full" });
      ws.close(4005, "full");
      return;
    }

    room = target;
    member = { id: user.id, name: user.name, avatarSeed: user.avatarSeed, isHost };
    room.members.set(ws, member);
    scheduleCleanup(room);
    send(ws, {
      type: "welcome",
      room: summary(room),
      you: member,
      members: memberList(room),
      chat: room.chat,
      state: { time: currentTime(room), paused: room.state.paused, media: room.media },
    });
    broadcast(room, { type: "members", members: memberList(room) }, ws);
    if (!alreadyIn) systemChat(room, `${user.name} ${isHost ? "started the party" : "joined"}`);
  };

  ws.on("message", (raw) => {
    const now = Date.now();
    if (now - windowStart > 1000) {
      windowStart = now;
      windowCount = 0;
    }
    windowCount += 1;
    if (windowCount > MAX_MESSAGES_PER_SECOND) return;

    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    if (!message || typeof message.type !== "string") return;

    if (!room) {
      if (message.type === "hello" && !joining)
        join(message).catch(() => ws.close(1011, "join failed"));
      return;
    }

    switch (message.type) {
      case "state": {
        if (!member.isHost) return;
        const time = Number(message.time);
        if (!Number.isFinite(time) || time < 0) return;
        room.state = { time, paused: Boolean(message.paused), at: now };
        const media = message.media ? cleanMedia(message.media) : null;
        if (media) room.media = media;
        broadcast(room, { type: "state", time, paused: room.state.paused, media: room.media }, ws);
        return;
      }
      case "sync":
        send(ws, {
          type: "state",
          time: currentTime(room),
          paused: room.state.paused,
          media: room.media,
        });
        return;
      case "chat": {
        const text =
          typeof message.text === "string"
            ? message.text.replace(/\s+/g, " ").trim().slice(0, MAX_CHAT_LENGTH)
            : "";
        if (!text || now - lastChatAt < CHAT_GAP_MS) return;
        lastChatAt = now;
        pushChat(room, {
          id: crypto.randomUUID(),
          name: member.name,
          text,
          at: now,
          isHost: member.isHost,
        });
        return;
      }
      case "end":
        if (member.isHost) closeRoom(room, "The host ended the party");
        return;
      case "ping":
        send(ws, { type: "pong" });
        return;
      default:
    }
  });

  ws.on("close", () => {
    clearTimeout(helloTimer);
    if (!room || !member) return;
    room.members.delete(ws);
    if (!rooms.has(room.code)) return;
    const stillHere = memberList(room).some((person) => person.id === member.id);
    broadcast(room, { type: "members", members: memberList(room) });
    if (!stillHere && !member.isHost) systemChat(room, `${member.name} left`);
    scheduleCleanup(room);
  });
});

// drop sockets whose other end vanished without closing
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30 * 1000);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`flux-party listening on 127.0.0.1:${PORT}`);
});
