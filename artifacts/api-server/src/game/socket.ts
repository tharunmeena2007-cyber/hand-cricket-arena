import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  cleanPlayerName,
  createRoom,
  deleteRoom,
  getRoom,
  getRoomSnapshot,
  isValidPlayerId,
  newRoomCode,
  removePlayer,
  setBowler,
  setTeam,
  startMatch,
  submitNumber,
  updateMode,
  type GameMode,
  type PlayerRecord,
  type RoomRecord,
  type Team,
} from "./engine";
import { logger } from "../lib/logger";

type AckResult =
  | {
      ok: true;
      roomCode: string;
      playerId: string;
      room: ReturnType<typeof getRoomSnapshot>;
    }
  | { ok: false; error: string };
type Ack = (result: AckResult) => void;
type SocketState = Socket & {
  data: {
    roomCode?: string;
    playerId?: string;
  };
};

interface JoinPayload {
  roomCode?: unknown;
  playerName?: unknown;
  playerId?: unknown;
}

function fail(ack: Ack | undefined, socket: Socket, message: string): void {
  ack?.({ ok: false, error: message });
  socket.emit("room:error", { message });
}

function acknowledgeRoom(ack: Ack | undefined, room: RoomRecord, player: PlayerRecord): void {
  ack?.({
    ok: true,
    roomCode: room.code,
    playerId: player.id,
    room: getRoomSnapshot(room),
  });
}

function broadcast(io: Server, room: RoomRecord): void {
  io.to(room.code).emit("room:state", getRoomSnapshot(room));
}

function getCurrentRoom(socket: SocketState): { room: RoomRecord; player: PlayerRecord } | null {
  const code = socket.data.roomCode;
  const playerId = socket.data.playerId;
  if (!code || !playerId) return null;
  const room = getRoom(code);
  const player = room?.players.find(
    (member) => member.id === playerId && member.socketId === socket.id,
  );
  return room && player ? { room, player } : null;
}

function validateIdentity(payload: JoinPayload): { name: string; id: string } | null {
  const name = cleanPlayerName(payload.playerName);
  const id = payload.playerId;
  return name && isValidPlayerId(id) ? { name, id } : null;
}

function joinExistingRoom(
  socket: SocketState,
  io: Server,
  payload: JoinPayload,
  acknowledge: Ack | undefined,
  resume: boolean,
): void {
  const roomCode = typeof payload.roomCode === "string" ? payload.roomCode.trim().toUpperCase() : "";
  const room = getRoom(roomCode);
  if (!room) {
    fail(acknowledge, socket, "Room not found. Check the code and try again.");
    return;
  }

  let player: PlayerRecord | undefined;
  if (resume) {
    if (!isValidPlayerId(payload.playerId)) {
      fail(acknowledge, socket, "Your saved player session is invalid. Rejoin with your name.");
      return;
    }
    player = room.players.find((member) => member.id === payload.playerId);
    if (!player) {
      fail(acknowledge, socket, "Your player is no longer in this room. Join again with your name.");
      return;
    }
    if (player.connected && player.socketId !== socket.id) {
      fail(acknowledge, socket, "This player is already connected in another tab.");
      return;
    }
    player.connected = true;
    player.socketId = socket.id;
    player.name = cleanPlayerName(payload.playerName) ?? player.name;
    if (room.cleanupTimeout) {
      clearTimeout(room.cleanupTimeout);
      room.cleanupTimeout = null;
    }
  } else {
    const identity = validateIdentity(payload);
    if (!identity) {
      fail(acknowledge, socket, "Enter a player name between 2 and 18 characters.");
      return;
    }
    if (room.players.some((member) => member.id === identity.id)) {
      fail(acknowledge, socket, "That player is already in the room. Use reconnect to return.");
      return;
    }
    if (room.players.length >= 8) {
      fail(acknowledge, socket, "This room is full. Ask the host to make a new room.");
      return;
    }
    player = {
      id: identity.id,
      name: identity.name,
      team: null,
      connected: true,
      socketId: socket.id,
    };
    room.players.push(player);
    room.notice = `${player.name} joined the room.`;
  }

  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  void socket.join(room.code);
  acknowledgeRoom(acknowledge, room, player);
  broadcast(io, room);
  logger.info({ roomCode: room.code, playerId: player.id, resume }, "Player joined game room");
}

export function attachGameSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: "/socket.io",
    serveClient: false,
    pingTimeout: 20_000,
    pingInterval: 25_000,
  });

  io.on("connection", (rawSocket) => {
    const socket = rawSocket as SocketState;

    socket.on("room:create", (payload: JoinPayload, acknowledge?: Ack) => {
      if (socket.data.roomCode) {
        fail(acknowledge, socket, "Leave your current room before creating another.");
        return;
      }
      const identity = validateIdentity(payload);
      if (!identity) {
        fail(acknowledge, socket, "Enter a player name between 2 and 18 characters.");
        return;
      }
      const code = newRoomCode();
      const player: PlayerRecord = {
        id: identity.id,
        name: identity.name,
        team: null,
        connected: true,
        socketId: socket.id,
      };
      const room = createRoom(code, player);
      socket.data.roomCode = code;
      socket.data.playerId = player.id;
      void socket.join(code);
      acknowledgeRoom(acknowledge, room, player);
      broadcast(io, room);
      logger.info({ roomCode: code, playerId: player.id }, "Game room created");
    });

    socket.on("room:join", (payload: JoinPayload, acknowledge?: Ack) => {
      if (socket.data.roomCode) {
        fail(acknowledge, socket, "Leave your current room before joining another.");
        return;
      }
      joinExistingRoom(socket, io, payload, acknowledge, false);
    });

    socket.on("room:resume", (payload: JoinPayload, acknowledge?: Ack) => {
      joinExistingRoom(socket, io, payload, acknowledge, true);
    });

    socket.on("room:choose-team", (payload: { team?: unknown }) => {
      const current = getCurrentRoom(socket);
      if (!current) return fail(undefined, socket, "You are not in a room.");
      if (payload?.team !== "A" && payload?.team !== "B") {
        return fail(undefined, socket, "Choose Team A or Team B.");
      }
      const error = setTeam(current.room, current.player, payload.team as Team);
      if (error) return fail(undefined, socket, error);
      broadcast(io, current.room);
    });

    socket.on("room:set-mode", (payload: { mode?: unknown }) => {
      const current = getCurrentRoom(socket);
      if (!current) return fail(undefined, socket, "You are not in a room.");
      if (current.player.id !== current.room.hostPlayerId) {
        return fail(undefined, socket, "Only the host can change the game mode.");
      }
      const error = updateMode(current.room, payload?.mode as GameMode);
      if (error) return fail(undefined, socket, error);
      broadcast(io, current.room);
    });

    socket.on("room:start", () => {
      const current = getCurrentRoom(socket);
      if (!current) return fail(undefined, socket, "You are not in a room.");
      if (current.player.id !== current.room.hostPlayerId) {
        return fail(undefined, socket, "Only the host can start the match.");
      }
      const error = startMatch(current.room);
      if (error) return fail(undefined, socket, error);
      broadcast(io, current.room);
    });

    socket.on("game:submit-number", (payload: { number?: unknown }) => {
      const current = getCurrentRoom(socket);
      if (!current) return fail(undefined, socket, "You are not in a room.");
      const error = submitNumber(current.room, current.player, payload?.number);
      if (error) return fail(undefined, socket, error);
      broadcast(io, current.room);
    });

    socket.on("game:change-bowler", (payload: { bowlerId?: unknown }) => {
      const current = getCurrentRoom(socket);
      if (!current) return fail(undefined, socket, "You are not in a room.");
      const error = setBowler(current.room, current.player, payload?.bowlerId);
      if (error) return fail(undefined, socket, error);
      broadcast(io, current.room);
    });

    socket.on("room:reset-match", () => {
      const current = getCurrentRoom(socket);
      if (!current) return fail(undefined, socket, "You are not in a room.");
      if (current.player.id !== current.room.hostPlayerId) {
        return fail(undefined, socket, "Only the host can reset the match.");
      }
      current.room.phase = "lobby";
      current.room.match = null;
      current.room.notice = "Match reset. Teams and game mode are unchanged.";
      broadcast(io, current.room);
    });

    socket.on("room:leave", (_payload: unknown, acknowledge?: Ack) => {
      const current = getCurrentRoom(socket);
      if (!current) {
        acknowledge?.({ ok: false, error: "You are no longer in a room." });
        return;
      }
      const { room, player } = current;
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
      void socket.leave(room.code);
      removePlayer(room, player);
      acknowledge?.({
        ok: true,
        roomCode: room.code,
        playerId: player.id,
        room: getRoomSnapshot(room),
      });
      if (getRoom(room.code)) broadcast(io, room);
    });

    socket.on("disconnect", () => {
      const code = socket.data.roomCode;
      const playerId = socket.data.playerId;
      const room = code ? getRoom(code) : undefined;
      const player = room?.players.find((member) => member.id === playerId);
      if (!room || !player || player.socketId !== socket.id) return;
      player.connected = false;
      player.socketId = null;
      if (room.hostPlayerId === player.id) {
        room.hostPlayerId = room.players.find((member) => member.connected)?.id ?? player.id;
      }
      room.notice = `${player.name} disconnected. They can rejoin this room.`;
      broadcast(io, room);
      if (room.players.every((member) => !member.connected)) {
        room.cleanupTimeout = setTimeout(() => {
          if (room.players.every((member) => !member.connected)) deleteRoom(room.code);
        }, 10 * 60 * 1000);
      }
      logger.info({ roomCode: room.code, playerId: player.id }, "Player disconnected");
    });
  });

  return io;
}
